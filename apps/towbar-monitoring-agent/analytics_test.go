package main

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

const analyticsTestID = "11111111-1111-4111-8111-111111111111"

func testAnalytics() *analyticsCollector {
	a := newAnalyticsCollector()
	a.services[analyticsTestID] = analyticsService{ID: analyticsTestID, Host: "example.com", Pageviews: true, VisitorIdentity: true, ExcludePaths: []string{"/private"}}
	a.refreshed = time.Now()
	return a
}
func TestAnalyticsRequestPrivacyAndHistogram(t *testing.T) {
	a := testAnalytics()
	a.request([]byte(`{"service":"` + analyticsTestID + `","path":"/docs?token=secret#fragment","method":"GET","status":503,"duration":0.12,"size":100,"request":{"remote_ip":"1.2.3.4","headers":{"Authorization":["secret"]}}}`))
	if len(a.cells) != 1 {
		t.Fatal(a.cells)
	}
	for _, c := range a.cells {
		if c.Path != "/docs" || c.Count != 1 || c.Histogram[3] != 1 || c.Country != "" || c.City != "" || c.Region != "" || c.Visitor != "" {
			t.Fatal(c)
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
	for _, secret := range []string{"token", "secret", "1.2.3.4", "Authorization"} {
		if strings.Contains(string(data), secret) {
			t.Fatalf("leaked %s", secret)
		}
	}
}
func TestAnalyticsBoundsAndFailClosedConfiguration(t *testing.T) {
	a := testAnalytics()
	a.add(AnalyticsCell{AppID: analyticsTestID, Kind: "pageview", Path: "/private/account", Count: 1})
	a.add(AnalyticsCell{AppID: analyticsTestID, Kind: "pageview", Path: "/%70rivate/account", Count: 1})
	a.add(AnalyticsCell{AppID: analyticsTestID, Kind: "pageview", Path: "/.well-known/towbar-analytics/script.js", Count: 1})
	a.add(AnalyticsCell{AppID: "unknown", Kind: "pageview", Path: "/", Count: 1})
	if len(a.cells) != 0 {
		t.Fatal(a.cells)
	}
	for i := 0; i < 513; i++ {
		a.add(AnalyticsCell{AppID: analyticsTestID, Kind: "pageview", Path: "/" + strings.Repeat("a", i%200), Visitor: strings.Repeat("a", 64), Session: hashIdentity(analyticsTestID, strings.Repeat("0", 28)+strings.Repeat("1", 4)), Status: i, Count: 1})
	}
	if len(a.cells) != 512 || a.dropped != 1 {
		t.Fatal(len(a.cells), a.dropped)
	}
	a.refreshed = time.Now().Add(-3 * time.Minute)
	a.add(AnalyticsCell{AppID: analyticsTestID, Kind: "pageview", Path: "/new", Count: 1})
	if a.dropped != 1 {
		t.Fatal("stale config accepted data")
	}
}
func TestBrowserOriginIdentityAndPrivacy(t *testing.T) {
	for _, tc := range []struct {
		origin, path string
		identity     bool
		status       int
	}{{"https://evil.example", "/", true, 403}, {"https://example.com", "/docs?secret=yes", true, 204}, {"https://example.com", "/docs", false, 204}} {
		a := testAnalytics()
		s := a.services[analyticsTestID]
		s.VisitorIdentity = tc.identity
		a.services[analyticsTestID] = s
		body := `{"path":"` + tc.path + `","referrer":"https://user:password@search.example/find?token=secret","visitor":"` + strings.Repeat("a", 32) + `","session":"` + strings.Repeat("b", 32) + `"}`
		req := httptest.NewRequest("POST", "https://example.com/.well-known/towbar-analytics/event", strings.NewReader(body))
		req.Header.Set("Origin", tc.origin)
		req.Header.Set("X-Towbar-Service", analyticsTestID)
		req.Header.Set("User-Agent", "Mozilla Chrome/120 mobile")
		res := httptest.NewRecorder()
		a.browser(res, req)
		if res.Code != tc.status {
			t.Fatal(res.Code, res.Body.String())
		}
		for _, cell := range a.cells {
			if cell.Path != "/docs" || cell.Referrer != "search.example" || cell.Browser != "Chrome" || cell.Device != "Mobile" {
				t.Fatal(cell)
			}
			if (cell.Visitor != "") != tc.identity {
				t.Fatal(cell)
			}
			if strings.Contains(cell.Visitor, strings.Repeat("a", 32)) {
				t.Fatal("unhashed identity")
			}
		}
	}
}
func TestReferrerAndPathSanitization(t *testing.T) {
	for raw, want := range map[string]string{"https://user:secret@EXAMPLE.com/a?q=s": "example.com", "javascript:alert(1)": "", "not a url": "", "https://example.com:443/path": "example.com"} {
		if got := referrerHost(raw); got != want {
			t.Fatal(raw, got)
		}
	}
	if cleanPath("https://example.com/path") != "/[invalid]" {
		t.Fatal("absolute URL accepted")
	}
	if cleanPath("/"+strings.Repeat("a", 300)) != "/[long-path]" {
		t.Fatal("oversized path accepted")
	}
}
func TestGeoFailurePreservesDatabase(t *testing.T) {
	directory := t.TempDir()
	g := openGeoDatabase(directory)
	if err := os.WriteFile(g.path, []byte("last valid file"), 0600); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if g.update(ctx, "new", time.Now()) == nil {
		t.Fatal("canceled refresh succeeded")
	}
	data, _ := os.ReadFile(g.path)
	if string(data) != "last valid file" {
		t.Fatal("failed update replaced database")
	}
	if g.location("127.0.0.1") != (geoLocation{}) || g.location("10.1.2.3") != (geoLocation{}) {
		t.Fatal("private IP geolocated")
	}
}
func TestAnalyticsQueueFailureKeepsPendingCells(t *testing.T) {
	a := testAnalytics()
	a.add(AnalyticsCell{AppID: analyticsTestID, Kind: "pageview", Path: "/", Count: 1})
	path := filepath.Join(t.TempDir(), "file")
	os.WriteFile(path, []byte("x"), 0600)
	sample := Sample{ID: randomID(), CollectedAt: time.Now()}
	if a.flush(&sample, &Queue{Dir: path}, time.Now()) == nil || len(a.cells) != 1 {
		t.Fatal("queue failure lost pending analytics")
	}
	encoded, _ := json.Marshal(a.cells)
	if len(encoded) == 0 {
		t.Fatal("missing cells")
	}
}

func TestLiveGeoDownload(t *testing.T) {
	if os.Getenv("TOWBAR_TEST_GEO_DOWNLOAD") != "1" {
		t.Skip("set TOWBAR_TEST_GEO_DOWNLOAD=1 to test provider download")
	}
	g := openGeoDatabase(t.TempDir())
	if err := g.update(context.Background(), "live", time.Now()); err != nil {
		t.Fatal(err)
	}
	if g.location("8.8.8.8").City == "" || g.location("8.8.8.8").Country == "" {
		t.Fatal("downloaded database lookup failed")
	}
	if err := g.update(context.Background(), "next-day", time.Now()); err != nil {
		t.Fatal(err)
	}
}

func TestAnalyticsIngressRateLimit(t *testing.T) {
	a := testAnalytics()
	a.ingressWindow = time.Now().Unix()
	a.ingressCount = 1000
	req := httptest.NewRequest("POST", "https://example.com/.well-known/towbar-analytics/event", strings.NewReader(`{}`))
	res := httptest.NewRecorder()
	a.browser(res, req)
	if res.Code != 429 || a.dropped != 1 {
		t.Fatal("ingress limit not enforced", res.Code, a.dropped)
	}
}

func TestVerifiedCloudflareClientIP(t *testing.T) {
	a := testAnalytics()
	a.tunnelPeers = map[string][]string{analyticsTestID: {"172.17.0.5"}}
	a.peerCollectedAt = time.Now()
	for _, tc := range []struct {
		peer          string
		proxy, tunnel bool
		want          string
	}{
		{"104.16.1.2", true, false, "8.8.8.8"},
		{"2606:4700::1234", true, false, "8.8.8.8"},
		{"203.0.113.10", true, false, ""},
		{"172.17.0.5", false, true, "8.8.8.8"},
		{"172.17.0.6", false, true, ""},
		{"127.0.0.1", false, true, ""},
		{"104.16.1.2", false, false, ""},
		{"8.8.4.4", false, false, "8.8.4.4"},
	} {
		r := httptest.NewRequest("POST", "https://example.com/", nil)
		r.Header.Set("X-Towbar-Client-IP", tc.peer)
		r.Header.Set("X-Towbar-CF-IP", "8.8.8.8")
		r.Header.Set("X-Forwarded-For", "9.9.9.9")
		service := analyticsService{ID: analyticsTestID, CloudflareProxy: tc.proxy, CloudflareTunnel: tc.tunnel}
		if got := a.clientIP(service, r); got != tc.want {
			t.Fatalf("%+v: got %q", tc, got)
		}
	}
	r := httptest.NewRequest("POST", "https://example.com/", nil)
	r.Header.Set("X-Towbar-Client-IP", "172.17.0.5")
	r.Header.Set("X-Towbar-CF-IP", "8.8.8.8")
	a.peerCollectedAt = time.Now().Add(-2 * time.Minute)
	if a.clientIP(analyticsService{ID: analyticsTestID, CloudflareTunnel: true}, r) != "" {
		t.Fatal("stale tunnel peer trusted")
	}
}
func TestTunnelPeersNeverLeaveLocalSnapshot(t *testing.T) {
	a := testAnalytics()
	sample := Sample{ID: randomID(), CollectedAt: time.Now(), TunnelPeers: map[string][]string{analyticsTestID: {"172.17.0.5"}}}
	q := &Queue{Dir: t.TempDir()}
	if err := a.flush(&sample, q, time.Now()); err != nil {
		t.Fatal(err)
	}
	_, data, err := q.next(time.Now())
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(data), "172.17.0.5") || strings.Contains(string(data), "tunnelPeers") {
		t.Fatal("local trust snapshot leaked")
	}
	if len(a.tunnelPeers[analyticsTestID]) != 1 {
		t.Fatal("local trust not updated")
	}
}

func TestTunnelTrustRequiresRunningOwnedContainerAndFreshDockerRead(t *testing.T) {
	fail := false
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if fail {
			w.WriteHeader(503)
			return
		}
		_, _ = w.Write([]byte(`[
		{"State":"running","Labels":{"towbar.managed":"true","towbar.ingress":"cloudflare-tunnel","towbar.app":"` + analyticsTestID + `"},"NetworkSettings":{"Networks":{"bridge":{"IPAddress":"172.17.0.5"}}}},
		{"State":"exited","Labels":{"towbar.managed":"true","towbar.ingress":"cloudflare-tunnel","towbar.app":"` + analyticsTestID + `"},"NetworkSettings":{"Networks":{"bridge":{"IPAddress":"172.17.0.6"}}}},
		{"State":"running","Labels":{"towbar.managed":"false","towbar.ingress":"cloudflare-tunnel","towbar.app":"` + analyticsTestID + `"},"NetworkSettings":{"Networks":{"bridge":{"IPAddress":"172.17.0.7"}}}}
		]`))
	}))
	defer server.Close()
	c := newCollector()
	c.client = &http.Client{Transport: analyticsTestTransport{base: server.URL}}
	_, _, errors := c.containers(context.Background(), time.Now())
	if errors != 0 || len(c.tunnelPeers[analyticsTestID]) != 1 || c.tunnelPeers[analyticsTestID][0] != "172.17.0.5" {
		t.Fatalf("wrong trusted peers: %v, errors %d", c.tunnelPeers, errors)
	}
	fail = true
	_, _, errors = c.containers(context.Background(), time.Now())
	if errors != 1 || len(c.tunnelPeers) != 0 {
		t.Fatal("Docker failure must clear old trust")
	}
}

type analyticsTestTransport struct{ base string }

func (t analyticsTestTransport) RoundTrip(r *http.Request) (*http.Response, error) {
	clone := r.Clone(r.Context())
	target, _ := url.Parse(t.base + r.URL.RequestURI())
	clone.URL = target
	return http.DefaultTransport.RoundTrip(clone)
}

func TestCloudflareIPv6CompanionOnlyAppliesToPseudoIPv4(t *testing.T) {
	a := testAnalytics()
	service := analyticsService{ID: analyticsTestID, CloudflareProxy: true}
	r := httptest.NewRequest("POST", "https://example.com/", nil)
	r.Header.Set("X-Towbar-Client-IP", "104.16.1.2")
	r.Header.Set("X-Towbar-CF-IP", "8.8.8.8")
	r.Header.Set("X-Towbar-CF-IPv6", "2001:4860:4860::8888")
	if got := a.clientIP(service, r); got != "8.8.8.8" {
		t.Fatal("unrelated IPv6 header replaced verified address", got)
	}
	r.Header.Set("X-Towbar-CF-IP", "240.16.0.1")
	if got := a.clientIP(service, r); got != "2001:4860:4860::8888" {
		t.Fatal("original IPv6 lost", got)
	}
	r.Header.Del("X-Towbar-CF-IPv6")
	if got := a.clientIP(service, r); got != "" {
		t.Fatal("pseudo address should be unknown without original IPv6", got)
	}
}

func TestAnalyticsLatencyBoundaries(t *testing.T) {
	for _, tc := range []struct {
		ms     float64
		bucket int
	}{{9.9, 0}, {10, 1}, {50, 1}, {50.1, 2}, {100, 2}, {100.1, 3}, {200, 3}, {200.1, 4}, {500, 4}, {1000, 5}, {2500, 6}, {2500.1, 7}, {90000, 7}} {
		a := testAnalytics()
		data, err := json.Marshal(map[string]any{"service": analyticsTestID, "path": "/", "method": "GET", "status": 200, "duration": tc.ms / 1000, "size": 1})
		if err != nil {
			t.Fatal(err)
		}
		a.request(data)
		if len(a.cells) != 1 {
			t.Fatal("request not recorded")
		}
		for _, cell := range a.cells {
			if cell.Histogram[tc.bucket] != 1 {
				t.Fatalf("%g ms: expected bucket %d, got %v", tc.ms, tc.bucket, cell.Histogram)
			}
		}
	}
}

func TestAnalyticsCollectionReadiness(t *testing.T) {
	a := testAnalytics()
	a.ready = true
	q := &Queue{Dir: t.TempDir()}
	now := time.Now()
	for index := 0; index < 3; index++ {
		sample := Sample{ID: randomID(), CollectedAt: now}
		if index == 2 {
			a.refreshed = now.Add(-3 * time.Minute)
		}
		if err := a.flush(&sample, q, now); err != nil {
			t.Fatal(err)
		}
		if index == 1 {
			if len(sample.AnalyticsServices) != 1 || !sample.AnalyticsServices[0].Pageviews {
				t.Fatal("ready zero-traffic service missing", sample)
			}
		} else if len(sample.AnalyticsServices) != 0 {
			t.Fatal("startup or stale config marked ready", sample)
		}
	}
}

func TestBrowserEngagementAndOutboundValidation(t *testing.T) {
	started := time.Now().Add(-time.Minute).UTC().Format(time.RFC3339Nano)
	for _, tc := range []struct {
		kind, page, destination string
		duration                any
		want                    int
	}{
		{"engagement", strings.Repeat("a", 32), "", 15000, 204},
		{"engagement", "", "", 15000, 400},
		{"engagement", strings.Repeat("a", 32), "", -1, 400},
		{"engagement", strings.Repeat("a", 32), "", 86400001, 400},
		{"outbound", strings.Repeat("a", 32), "https://user:secret@OTHER.example/path?secret=yes", nil, 204},
		{"outbound", strings.Repeat("a", 32), "javascript:alert(1)", nil, 400},
		{"outbound", strings.Repeat("a", 32), "https://example.com/a", nil, 400},
		{"request", strings.Repeat("a", 32), "", nil, 400},
	} {
		a := testAnalytics()
		event := map[string]any{"kind": tc.kind, "path": "/docs", "pageId": tc.page, "destination": tc.destination}
		if tc.page != "" {
			event["pageStartedAt"] = started
		}
		if tc.duration != nil {
			event["visibleMs"] = tc.duration
		}
		body, _ := json.Marshal(event)
		req := httptest.NewRequest("POST", "https://example.com/.well-known/towbar-analytics/event", strings.NewReader(string(body)))
		req.Header.Set("Origin", "https://example.com")
		req.Header.Set("X-Towbar-Service", analyticsTestID)
		res := httptest.NewRecorder()
		a.browser(res, req)
		if res.Code != tc.want {
			t.Fatalf("%s: %d %s", tc.kind, res.Code, res.Body.String())
		}
		for _, cell := range a.cells {
			if cell.Kind != tc.kind || len(cell.PageID) != 64 {
				t.Fatal(cell)
			}
			if cell.Kind == "outbound" && cell.Destination != "other.example" {
				t.Fatal(cell)
			}
		}
	}
}
func TestCumulativeEngagementIsNotAddedTwice(t *testing.T) {
	a := testAnalytics()
	for _, duration := range []int64{15000, 30000, 15000} {
		a.add(AnalyticsCell{AppID: analyticsTestID, Kind: "engagement", Path: "/", PageID: strings.Repeat("a", 64), Count: 1, VisibleMs: &duration})
	}
	if len(a.cells) != 1 {
		t.Fatal(a.cells)
	}
	for _, cell := range a.cells {
		if cell.VisibleMs == nil || *cell.VisibleMs != 30000 {
			t.Fatal(cell)
		}
	}
}
