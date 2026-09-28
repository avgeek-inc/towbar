package main

import (
	"bytes"
	"compress/gzip"
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func installGeoFixture(t *testing.T, directory, kind, filename string) {
	t.Helper()
	data, err := os.ReadFile(filepath.Join("testdata", "geo", kind+".mmdb"))
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(directory, filename), data, 0600); err != nil {
		t.Fatal(err)
	}
}

func TestCityLookupAndPageviewPrivacy(t *testing.T) {
	directory := t.TempDir()
	installGeoFixture(t, directory, "City", "city.mmdb")
	g := openGeoDatabase(directory)
	defer g.reader.Close()
	for address, want := range map[string]geoLocation{
		"8.8.8.8":              {Country: "US", City: "Mountain View", Region: "California"},
		"2001:4860:4860::8888": {Country: "BR", City: "São Paulo", Region: "São Paulo"},
		"9.9.9.9":              {Country: "US"},
		"127.0.0.1":            {}, "10.0.0.1": {}, "::1": {}, "invalid": {},
	} {
		if got := g.location(address); got != want {
			t.Fatalf("%s: got %+v, want %+v", address, got, want)
		}
	}
	a := testAnalytics()
	a.geo = g
	req := httptest.NewRequest("POST", "https://example.com/.well-known/towbar-analytics/event", strings.NewReader(`{"path":"/","city":"spoofed","country":"ZZ"}`))
	req.Header.Set("Origin", "https://example.com")
	req.Header.Set("X-Towbar-Service", analyticsTestID)
	req.Header.Set("X-Towbar-Client-IP", "8.8.8.8")
	response := httptest.NewRecorder()
	a.browser(response, req)
	if response.Code != 400 {
		t.Fatal("client location must be rejected", response.Code)
	}
	req = httptest.NewRequest("POST", "https://example.com/.well-known/towbar-analytics/event", strings.NewReader(`{"path":"/"}`))
	req.Header.Set("Origin", "https://example.com")
	req.Header.Set("X-Towbar-Service", analyticsTestID)
	req.Header.Set("X-Towbar-Client-IP", "8.8.8.8")
	response = httptest.NewRecorder()
	a.browser(response, req)
	if response.Code != 204 || len(a.cells) != 1 {
		t.Fatal(response.Code, a.cells)
	}
	for _, cell := range a.cells {
		if cell.City != "Mountain View" || cell.Region != "California" || cell.Country != "US" {
			t.Fatal(cell)
		}
	}
	sample := Sample{ID: randomID(), CollectedAt: time.Now()}
	q := &Queue{Dir: t.TempDir()}
	if err := a.flush(&sample, q, time.Now()); err != nil {
		t.Fatal(err)
	}
	_, data, err := q.next(time.Now())
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Contains(data, []byte("8.8.8.8")) || bytes.Contains(data, []byte("spoofed")) {
		t.Fatal("raw IP or supplied location uploaded")
	}
	if !bytes.Contains(data, []byte("Mountain View")) {
		t.Fatal("city missing from upload")
	}
}

type geoTransport func(*http.Request) (*http.Response, error)

func (f geoTransport) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

func TestCountryToCityDatabaseUpgrade(t *testing.T) {
	directory := t.TempDir()
	installGeoFixture(t, directory, "Country", "country.mmdb")
	g := openGeoDatabase(directory)
	defer func() { g.reader.Close() }()
	if g.location("8.8.8.8") != (geoLocation{Country: "US"}) {
		t.Fatal("country fallback unavailable")
	}
	before, _ := os.ReadFile(filepath.Join(directory, "country.mmdb"))
	oldTransport := http.DefaultTransport
	t.Cleanup(func() { http.DefaultTransport = oldTransport })
	kind := "Country"
	calls := 0
	http.DefaultTransport = geoTransport(func(req *http.Request) (*http.Response, error) {
		if req.URL.String() != "https://download.db-ip.com/free/dbip-city-lite-2026-09.mmdb.gz" {
			t.Fatal(req.URL)
		}
		calls++
		data, err := os.ReadFile(filepath.Join("testdata", "geo", kind+".mmdb"))
		if err != nil {
			t.Fatal(err)
		}
		var compressed bytes.Buffer
		writer := gzip.NewWriter(&compressed)
		writer.Write(data)
		writer.Close()
		return &http.Response{StatusCode: 200, Body: io.NopCloser(&compressed)}, nil
	})
	now := time.Date(2026, 9, 28, 0, 0, 0, 0, time.UTC)
	if err := g.update(context.Background(), "initial", now); err == nil {
		t.Fatal("country database accepted as city database")
	}
	after, _ := os.ReadFile(filepath.Join(directory, "country.mmdb"))
	if !bytes.Equal(before, after) || g.location("8.8.8.8").Country != "US" {
		t.Fatal("failed migration lost country lookup")
	}
	kind = "City"
	if err := g.update(context.Background(), "initial", now); err != nil {
		t.Fatal(err)
	}
	if g.location("8.8.8.8").City != "Mountain View" {
		t.Fatal("same-month country database prevented city upgrade")
	}
	info, err := os.Stat(g.path)
	if err != nil || info.Mode().Perm() != 0600 {
		t.Fatal("city database must be private")
	}
	if _, err := os.Stat(filepath.Join(directory, "country.mmdb")); !os.IsNotExist(err) {
		t.Fatal("obsolete country file remains")
	}
	if err := g.update(context.Background(), "next-day", now); err != nil {
		t.Fatal(err)
	}
	if calls != 2 {
		t.Fatal("current-month city database downloaded again", calls)
	}
	reloaded := openGeoDatabase(directory)
	defer reloaded.reader.Close()
	if reloaded.location("8.8.8.8").City != "Mountain View" {
		t.Fatal("installed city database cannot be reopened")
	}
}

func TestGeoNamesAreBounded(t *testing.T) {
	for _, value := range []string{"bad\nname", "bad\u202ename", strings.Repeat("x", 129)} {
		if geoName(value, 128) != "" {
			t.Fatal("invalid name accepted")
		}
	}
	if geoName(" São Paulo ", 128) != "São Paulo" {
		t.Fatal("unicode name lost")
	}
}
