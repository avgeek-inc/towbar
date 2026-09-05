package main

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestQueueSurvivesRestartAndAcknowledgement(t *testing.T) {
	dir := t.TempDir()
	now := time.Now().UTC()
	q := &Queue{Dir: dir}
	sample := Sample{ID: "one", CollectedAt: now, Entities: []Entity{{ID: "host", Metrics: map[string]float64{"cpuPercent": 25}}}}
	if e := q.add(sample, now); e != nil {
		t.Fatal(e)
	}
	restarted := &Queue{Dir: dir}
	path, data, e := restarted.next(now)
	if e != nil {
		t.Fatal(e)
	}
	var got Sample
	if e = json.Unmarshal(data, &got); e != nil || got.ID != "one" {
		t.Fatalf("lost buffered sample: %v", e)
	}
	if e = os.Remove(path); e != nil {
		t.Fatal(e)
	}
	path, _, e = restarted.next(now)
	if e != nil || path != "" {
		t.Fatal("acknowledged sample was replayed")
	}
}
func TestQueueIsBoundedByAgeAndBytes(t *testing.T) {
	dir := t.TempDir()
	q := &Queue{Dir: dir}
	now := time.Now()
	for i := 0; i < 15; i++ {
		path := filepath.Join(dir, time.Unix(int64(i), 0).UTC().Format("20060102T150405")+".json")
		if e := os.WriteFile(path, []byte(strings.Repeat("x", maxSampleBytes)), 0600); e != nil {
			t.Fatal(e)
		}
	}
	if e := q.prune(now, 0); e != nil {
		t.Fatal(e)
	}
	entries, _ := q.files()
	if len(entries) > 10 || q.Dropped != 5 {
		t.Fatalf("queue not bounded: %d files %d dropped", len(entries), q.Dropped)
	}
	for _, f := range entries {
		path := filepath.Join(dir, f.Name())
		old := now.Add(-2 * time.Hour)
		_ = os.Chtimes(path, old, old)
	}
	if e := q.prune(now, 0); e != nil {
		t.Fatal(e)
	}
	entries, _ = q.files()
	if len(entries) != 0 {
		t.Fatal("expired samples retained")
	}
}
func TestCounterSemantics(t *testing.T) {
	total, idle, cores := parseCPU("cpu 100 0 50 850 20 0 0 0 10 0\ncpu0 1\ncpu1 1\n")
	if total != 1020 || idle != 870 || cores != 2 {
		t.Fatalf("invalid CPU totals %v %v %v", total, idle, cores)
	}
	mem := parseMemory("MemTotal: 1000 kB\nMemAvailable: 250 kB\nSwapTotal: 100 kB\nSwapFree: 25 kB\n")
	if mem["memoryPercent"] != 75 || mem["memoryUsedBytes"] != 750*1024 || mem["swapUsedBytes"] != 75*1024 {
		t.Fatal(mem)
	}
	if rate(50, 100, 30) != 0 || rate(400, 100, 30) != 10 {
		t.Fatal("counter resets must not produce negative spikes")
	}
	rx, tx := parseNetwork("eth0: 300 0 0 0 0 0 0 0 600 0\nvethabc: 999 0 0 0 0 0 0 0 999 0\nlo: 999 0 0 0 0 0 0 0 999 0\n")
	if rx != 300 || tx != 600 {
		t.Fatal("double-counted bridged network")
	}
}
func TestUploadSendsScopedCredentialAndRejectsRedirect(t *testing.T) {
	calls := 0
	target := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { calls++; w.WriteHeader(200) }))
	defer target.Close()
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer test-token" || r.Header.Get("X-Towbar-Server") != "server-one" {
			t.Error("wrong credential scope")
		}
		http.Redirect(w, r, target.URL, http.StatusTemporaryRedirect)
	}))
	defer server.Close()
	client := server.Client()
	client.CheckRedirect = func(_ *http.Request, _ []*http.Request) error { return http.ErrUseLastResponse }
	status, _, err := upload(context.Background(), client, Config{Endpoint: server.URL, Token: "test-token", ServerID: "server-one"}, []byte(`{}`))
	if err != nil || status != 307 || calls != 0 {
		t.Fatalf("credential followed redirect: %d %v %d", status, err, calls)
	}
}
func TestCollectorHandlesDockerFailureWithoutDroppingHost(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(503) }))
	defer server.Close()
	c := newCollector()
	c.proc = t.TempDir()
	for name, value := range map[string]string{"stat": "cpu 100 0 0 100\ncpu0 0\n", "meminfo": "MemTotal: 1000 kB\nMemAvailable: 500 kB\n", "uptime": "100 0", "loadavg": "1 2 3", "diskstats": ""} {
		if e := os.WriteFile(filepath.Join(c.proc, name), []byte(value), 0600); e != nil {
			t.Fatal(e)
		}
	}
	_ = os.Mkdir(filepath.Join(c.proc, "net"), 0700)
	_ = os.WriteFile(filepath.Join(c.proc, "net/dev"), []byte("eth0: 100 0 0 0 0 0 0 0 200 0"), 0600)
	c.client = &http.Client{Transport: rewriteTransport{base: server.Client().Transport, url: server.URL}}
	sample := c.collect(context.Background(), time.Now())
	if len(sample.Entities) != 1 || sample.Entities[0].ID != "host" || sample.CollectionErrors < 1 || sample.Entities[0].Metrics["memoryPercent"] != 50 {
		t.Fatal(sample)
	}
}

type rewriteTransport struct {
	base http.RoundTripper
	url  string
}

func (r rewriteTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	clone := req.Clone(req.Context())
	clone.URL.Host = strings.TrimPrefix(r.url, "http://")
	clone.URL.Scheme = "http"
	return r.base.RoundTrip(clone)
}

func TestKilledWritesAndDropCountSurviveRestart(t *testing.T) {
	dir := t.TempDir()
	q := &Queue{Dir: dir}
	now := time.Now()
	for i := 0; i < 20; i++ {
		if err := os.WriteFile(filepath.Join(dir, fmt.Sprintf("%d.json.tmp", i)), make([]byte, 1024), 0600); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.WriteFile(filepath.Join(dir, "old.json"), []byte("{}"), 0600); err != nil {
		t.Fatal(err)
	}
	old := now.Add(-2 * time.Hour)
	_ = os.Chtimes(filepath.Join(dir, "old.json"), old, old)
	if err := q.prune(now, 0); err != nil {
		t.Fatal(err)
	}
	restarted := &Queue{Dir: dir}
	restarted.restoreDropped()
	if restarted.Dropped != 1 {
		t.Fatal("lost drop diagnostics on restart")
	}
	entries, _ := os.ReadDir(dir)
	if len(entries) != 1 || entries[0].Name() != "dropped" {
		t.Fatal("aborted writes retained", entries)
	}
}
func TestMissingCountersCreateGapsAndDoNotInventRecoverySpikes(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(503) }))
	defer server.Close()
	c := newCollector()
	c.client = &http.Client{Transport: rewriteTransport{base: server.Client().Transport, url: server.URL}}
	c.proc = t.TempDir()
	now := time.Now()
	c.previous["host"] = counter{map[string]float64{"cpu": 200, "idle": 100, "rx": 100}, now.Add(-30 * time.Second)}
	sample := c.collect(context.Background(), now)
	if _, present := sample.Entities[0].Metrics["cpuPercent"]; present {
		t.Fatal("failed CPU read became a measurement")
	}
	if _, present := sample.Entities[0].Metrics["networkRxBytesPerSecond"]; present {
		t.Fatal("failed network read became zero")
	}
}

func TestRevocationClearsContentsWithoutRemovingStateDirectory(t *testing.T) {
	q := &Queue{Dir: t.TempDir()}
	if err := os.WriteFile(filepath.Join(q.Dir, "sample.json"), []byte("{}"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := q.clear(); err != nil {
		t.Fatal(err)
	}
	entries, err := os.ReadDir(q.Dir)
	if err != nil || len(entries) != 0 {
		t.Fatal("state directory must remain empty", entries, err)
	}
}
