package main

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"os/signal"
	"syscall"
	"time"
)

var errRevoked = errors.New("monitoring credential revoked or invalid")

func main() {
	mode := flag.String("mode", "send", "collect or send")
	configPath := flag.String("config", "/etc/towbar-monitoring/config.json", "sender configuration")
	snapshot := flag.String("snapshot", "/run/towbar-monitoring/sample.json", "collector snapshot")
	queueDir := flag.String("queue", "/var/lib/towbar-monitoring", "bounded retry buffer")
	version := flag.Bool("version", false, "print version")
	flag.Parse()
	if *version {
		fmt.Println(Version)
		return
	}
	log.SetFlags(log.LstdFlags | log.LUTC)
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGTERM, syscall.SIGINT)
	defer stop()
	var err error
	if *mode == "collect" {
		err = collectLoop(ctx, *snapshot)
	} else if *mode == "send" {
		var config Config
		var data []byte
		data, err = os.ReadFile(*configPath)
		if err == nil {
			err = json.Unmarshal(data, &config)
		}
		if err == nil {
			err = validateConfig(config)
		}
		if err == nil {
			err = sendLoop(ctx, config, *snapshot, &Queue{Dir: *queueDir})
		}
	} else {
		err = errors.New("unknown mode")
	}
	if err != nil {
		log.Print("monitoring agent stopped: ", err)
		if errors.Is(err, errRevoked) {
			os.Exit(77)
		}
		os.Exit(1)
	}
}
func validateConfig(c Config) error {
	u, e := url.Parse(c.Endpoint)
	if e != nil || u.Scheme != "https" || u.Host == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" {
		return errors.New("metrics endpoint must be an HTTPS URL without credentials or query")
	}
	if c.ServerID == "" || len(c.Token) < 32 {
		return errors.New("server identity and credential are required")
	}
	return nil
}
func randomID() string {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		panic(err)
	}
	return hex.EncodeToString(b[:])
}
func collectLoop(ctx context.Context, path string) error {
	c := newCollector()
	ticker := time.NewTicker(sampleInterval)
	defer ticker.Stop()
	for {
		start := time.Now()
		sample := c.collect(ctx, start)
		data, err := json.Marshal(sample)
		if err == nil && len(data) <= maxSampleBytes {
			err = atomicWrite(path, data, 0640)
		}
		if err != nil {
			log.Print("could not write metrics snapshot")
		}
		select {
		case <-ctx.Done():
			return nil
		case <-ticker.C:
		}
	}
}
func sendLoop(ctx context.Context, c Config, snapshot string, q *Queue) error {
	if err := os.MkdirAll(q.Dir, 0700); err != nil {
		return err
	}
	q.restoreDropped()
	client := &http.Client{Timeout: 10 * time.Second, CheckRedirect: func(_ *http.Request, _ []*http.Request) error { return http.ErrUseLastResponse }}
	// Collection and uploads have independent schedules: backoff cannot stop bounded buffering.
	tick := time.NewTicker(time.Second)
	defer tick.Stop()
	var lastID string
	var nextRead, nextSend time.Time
	backoff := time.Second
	for {
		now := time.Now()
		if !now.Before(nextRead) {
			nextRead = now.Add(sampleInterval)
			info, err := os.Stat(snapshot)
			if err == nil && info.Size() <= maxSampleBytes {
				data, err := os.ReadFile(snapshot)
				var sample Sample
				if err == nil && json.Unmarshal(data, &sample) == nil && sample.ID != lastID && now.Sub(sample.CollectedAt) < 2*sampleInterval && sample.CollectedAt.Before(now.Add(time.Minute)) {
					if q.add(sample, now) == nil {
						lastID = sample.ID
					} else {
						log.Print("metrics buffer rejected a sample")
					}
				}
			}
		}
		if !now.Before(nextSend) {
			path, data, err := q.next(now)
			if err == nil && path != "" {
				status, retryAfter, err := upload(ctx, client, c, data)
				switch {
				case err == nil && status >= 200 && status < 300:
					_ = os.Remove(path)
					backoff = time.Second
					nextSend = now.Add(time.Second)
				case status == http.StatusUnauthorized || status == http.StatusForbidden:
					// Revoked credentials never keep collecting data indefinitely.
					if err := q.clear(); err != nil {
						log.Print("could not clear revoked credential retry buffer")
					}
					return errRevoked
				case status == http.StatusBadRequest || status == http.StatusRequestEntityTooLarge || status == http.StatusUnprocessableEntity:
					_ = os.Remove(path)
					q.Dropped++
					_ = q.persistDropped()
					nextSend = now.Add(sampleInterval)
				default:
					if retryAfter > backoff {
						backoff = retryAfter
					}
					if backoff > 5*time.Minute {
						backoff = 5 * time.Minute
					}
					nextSend = now.Add(backoff)
					backoff = min(2*backoff, 5*time.Minute)
					log.Print("metrics delivery delayed; retry buffer is bounded")
				}
			}
		}
		select {
		case <-ctx.Done():
			return nil
		case <-tick.C:
		}
	}
}
func upload(ctx context.Context, client *http.Client, c Config, data []byte) (int, time.Duration, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.Endpoint, bytes.NewReader(data))
	if err != nil {
		return 0, 0, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+c.Token)
	req.Header.Set("X-Towbar-Server", c.ServerID)
	req.Header.Set("User-Agent", "towbar-monitoring/"+Version)
	res, err := client.Do(req)
	if err != nil {
		return 0, 0, errors.New("upload failed")
	}
	defer res.Body.Close()
	_, _ = io.Copy(io.Discard, io.LimitReader(res.Body, 4096))
	retry := time.Duration(0)
	if n, e := time.ParseDuration(res.Header.Get("Retry-After") + "s"); e == nil {
		retry = n
	}
	return res.StatusCode, retry, nil
}
