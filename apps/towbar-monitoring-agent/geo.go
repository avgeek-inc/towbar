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
	"strings"
	"sync"
	"time"
	"unicode"

	"github.com/oschwald/maxminddb-golang"
)

type geoLocation struct {
	Country string
	City    string
	Region  string
}

type geoDatabase struct {
	mu      sync.RWMutex
	reader  *maxminddb.Reader
	path    string
	refresh string
}

func openGeoDatabase(directory string) *geoDatabase {
	g := &geoDatabase{path: filepath.Join(directory, "city.mmdb")}
	for _, path := range []string{g.path, filepath.Join(directory, "country.mmdb")} {
		if reader, err := maxminddb.Open(path); err == nil {
			g.reader = reader
			break
		}
	}
	return g
}

func (g *geoDatabase) location(address string) geoLocation {
	ip := net.ParseIP(address)
	if ip == nil || ip.IsPrivate() || ip.IsLoopback() || ip.IsUnspecified() {
		return geoLocation{}
	}
	g.mu.RLock()
	defer g.mu.RUnlock()
	if g.reader == nil {
		return geoLocation{}
	}
	var record struct {
		Country struct {
			ISOCode string `maxminddb:"iso_code"`
		} `maxminddb:"country"`
		City struct {
			Names map[string]string `maxminddb:"names"`
		} `maxminddb:"city"`
		Subdivisions []struct {
			Names map[string]string `maxminddb:"names"`
		} `maxminddb:"subdivisions"`
	}
	if g.reader.Lookup(ip, &record) != nil || len(record.Country.ISOCode) != 2 {
		return geoLocation{}
	}
	location := geoLocation{Country: record.Country.ISOCode, City: geoName(record.City.Names["en"], 128)}
	if location.City != "" && len(record.Subdivisions) > 0 {
		location.Region = geoName(record.Subdivisions[0].Names["en"], 96)
	}
	return location
}

func geoName(value string, maxBytes int) string {
	value = strings.TrimSpace(value)
	if len(value) > maxBytes || strings.ContainsFunc(value, func(r rune) bool {
		return unicode.IsControl(r) || unicode.Is(unicode.Cf, r)
	}) {
		return ""
	}
	return value
}

func (g *geoDatabase) update(ctx context.Context, marker string, now time.Time) error {
	if marker == g.refresh {
		return nil
	}
	month := now.UTC().Format("2006-01")
	g.mu.RLock()
	current := g.reader
	g.mu.RUnlock()
	if current != nil && strings.Contains(strings.ToLower(current.Metadata.DatabaseType), "city") && time.Unix(int64(current.Metadata.BuildEpoch), 0).UTC().Format("2006-01") == month {
		g.refresh = marker
		return nil
	}
	client := &http.Client{Timeout: 2 * time.Minute, CheckRedirect: func(_ *http.Request, _ []*http.Request) error { return http.ErrUseLastResponse }}
	req, err := http.NewRequestWithContext(ctx, "GET", fmt.Sprintf("https://download.db-ip.com/free/dbip-city-lite-%s.mmdb.gz", month), nil)
	if err != nil {
		return err
	}
	res, err := client.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	if res.StatusCode != 200 {
		return errors.New("city database download unavailable")
	}
	unzip, err := gzip.NewReader(io.LimitReader(res.Body, 128*1024*1024))
	if err != nil {
		return err
	}
	defer unzip.Close()
	if err := os.MkdirAll(filepath.Dir(g.path), 0700); err != nil {
		return err
	}
	file, err := os.CreateTemp(filepath.Dir(g.path), ".city-*.mmdb")
	if err != nil {
		return err
	}
	defer os.Remove(file.Name())
	defer file.Close()
	// Stream to disk and map the candidate rather than retaining a second city database on the Go heap.
	size, err := io.Copy(file, io.LimitReader(unzip, 256*1024*1024+1))
	if err != nil || size > 256*1024*1024 || size < 1024 {
		return errors.New("city database size invalid")
	}
	if err := file.Sync(); err != nil {
		return err
	}
	if err := file.Close(); err != nil {
		return err
	}
	candidate, err := maxminddb.Open(file.Name())
	if err != nil {
		return err
	}
	installed := false
	defer func() {
		if !installed {
			candidate.Close()
		}
	}()
	if !strings.Contains(strings.ToLower(candidate.Metadata.DatabaseType), "city") || candidate.Metadata.IPVersion != 6 || candidate.Metadata.NodeCount < 1000 || candidate.Metadata.BuildEpoch > uint(now.Add(24*time.Hour).Unix()) || candidate.Metadata.BuildEpoch < uint(now.AddDate(0, -3, 0).Unix()) {
		return errors.New("city database metadata invalid")
	}
	if err := candidate.Verify(); err != nil {
		return errors.New("city database validation failed")
	}
	if current != nil && candidate.Metadata.BuildEpoch < current.Metadata.BuildEpoch {
		return errors.New("city database rollback refused")
	}
	if err := os.Rename(file.Name(), g.path); err != nil {
		return err
	}
	g.mu.Lock()
	old := g.reader
	g.reader = candidate
	g.refresh = marker
	installed = true
	g.mu.Unlock()
	if old != nil {
		old.Close()
	}
	os.Remove(filepath.Join(filepath.Dir(g.path), "country.mmdb"))
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
