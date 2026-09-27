package main

import (
	"compress/gzip"
	"context"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/oschwald/maxminddb-golang"
)

type geoDatabase struct {
	mu      sync.RWMutex
	reader  *maxminddb.Reader
	path    string
	refresh string
}

func openGeoDatabase(directory string) *geoDatabase {
	g := &geoDatabase{path: filepath.Join(directory, "country.mmdb")}
	if reader, err := maxminddb.Open(g.path); err == nil {
		g.reader = reader
	}
	return g
}
func (g *geoDatabase) country(address string) string {
	ip := net.ParseIP(address)
	if ip == nil || ip.IsPrivate() || ip.IsLoopback() || ip.IsUnspecified() {
		return ""
	}
	g.mu.RLock()
	defer g.mu.RUnlock()
	if g.reader == nil {
		return ""
	}
	var record struct {
		Country struct {
			ISOCode string `maxminddb:"iso_code"`
		} `maxminddb:"country"`
	}
	if g.reader.Lookup(ip, &record) != nil || len(record.Country.ISOCode) != 2 {
		return ""
	}
	return record.Country.ISOCode
}
func (g *geoDatabase) update(ctx context.Context, marker string, now time.Time) error {
	if marker == g.refresh {
		return nil
	}
	month := now.UTC().Format("2006-01")
	// DB-IP Lite publishes monthly. Daily Temporal requests validate the current
	// release without repeatedly downloading an already installed edition.
	g.mu.RLock()
	current := g.reader
	g.mu.RUnlock()
	if current != nil && time.Unix(int64(current.Metadata.BuildEpoch), 0).UTC().Format("2006-01") == month {
		g.refresh = marker
		return nil
	}
	client := &http.Client{Timeout: 60 * time.Second, CheckRedirect: func(_ *http.Request, _ []*http.Request) error { return http.ErrUseLastResponse }}
	req, err := http.NewRequestWithContext(ctx, "GET", fmt.Sprintf("https://download.db-ip.com/free/dbip-country-lite-%s.mmdb.gz", month), nil)
	if err != nil {
		return err
	}
	res, err := client.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	if res.StatusCode != 200 {
		return errors.New("country database download unavailable")
	}
	compressed := io.LimitReader(res.Body, 16*1024*1024)
	unzip, err := gzip.NewReader(compressed)
	if err != nil {
		return err
	}
	defer unzip.Close()
	data, err := io.ReadAll(io.LimitReader(unzip, 32*1024*1024+1))
	if err != nil || len(data) > 32*1024*1024 || len(data) < 1024 {
		return errors.New("country database size invalid")
	}
	candidate, err := maxminddb.FromBytes(data)
	if err != nil {
		return err
	}
	if candidate.Metadata.IPVersion != 6 || candidate.Metadata.NodeCount < 1000 || candidate.Metadata.BuildEpoch > uint(now.Add(24*time.Hour).Unix()) || candidate.Metadata.BuildEpoch < uint(now.AddDate(0, -3, 0).Unix()) {
		candidate.Close()
		return errors.New("country database metadata invalid")
	}
	if err := candidate.Verify(); err != nil {
		candidate.Close()
		return errors.New("country database validation failed")
	}
	if current != nil && candidate.Metadata.BuildEpoch < current.Metadata.BuildEpoch {
		candidate.Close()
		return errors.New("country database rollback refused")
	}
	if err := os.MkdirAll(filepath.Dir(g.path), 0700); err != nil {
		candidate.Close()
		return err
	}
	if err := atomicWrite(g.path, data, 0600); err != nil {
		candidate.Close()
		return err
	}
	g.mu.Lock()
	old := g.reader
	g.reader = candidate
	g.refresh = marker
	g.mu.Unlock()
	if old != nil {
		old.Close()
	}
	return nil
}

func (g *geoDatabase) builtAt() string {
	g.mu.RLock()
	defer g.mu.RUnlock()
	if g.reader == nil {
		return ""
	}
	return time.Unix(int64(g.reader.Metadata.BuildEpoch), 0).UTC().Format(time.RFC3339)
}
