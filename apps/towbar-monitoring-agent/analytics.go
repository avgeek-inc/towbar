package main

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"
)

var latencyBounds = []float64{10, 50, 100, 250, 500, 1000, 2500, 5000, 10000, 60000}

type AnalyticsCell struct {
	AppID      string    `json:"appId"`
	Kind       string    `json:"kind"`
	Path       string    `json:"path"`
	Referrer   string    `json:"referrer"`
	Method     string    `json:"method"`
	Status     int       `json:"status"`
	Country    string    `json:"country"`
	Browser    string    `json:"browser"`
	Device     string    `json:"device"`
	Visitor    string    `json:"visitor"`
	Session    string    `json:"session"`
	Count      int64     `json:"count"`
	Bytes      int64     `json:"bytes"`
	DurationMs float64   `json:"durationMs"`
	Histogram  [11]int64 `json:"histogram"`
}
type analyticsService struct {
	CloudflareProxy  bool     `json:"cloudflareProxy"`
	CloudflareTunnel bool     `json:"cloudflareTunnel"`
	ID               string   `json:"id"`
	Host             string   `json:"host"`
	Pageviews        bool     `json:"pageviews"`
	VisitorIdentity  bool     `json:"visitorIdentity"`
	ExcludePaths     []string `json:"excludePaths"`
}
type analyticsConfig struct {
	Refresh  string             `json:"refresh"`
	Services []analyticsService `json:"services"`
}
type analyticsCollector struct {
	tunnelPeers     map[string][]string
	peerCollectedAt time.Time
	ready           bool
	period          time.Time
	ingressWindow   int64
	ingressCount    int
	mu              sync.Mutex
	cells           map[string]AnalyticsCell
	services        map[string]analyticsService
	refreshed       time.Time
	dropped         uint64
	geo             *geoDatabase
}

func newAnalyticsCollector() *analyticsCollector {
	return &analyticsCollector{cells: make(map[string]AnalyticsCell), services: make(map[string]analyticsService)}
}
func cleanPath(raw string) string {
	u, err := url.ParseRequestURI(raw)
	if err != nil || u.IsAbs() || !strings.HasPrefix(u.Path, "/") || strings.HasPrefix(u.Path, "//") {
		return "/[invalid]"
	}
	p := u.EscapedPath()
	if len(p) > 256 {
		return "/[long-path]"
	}
	return p
}
func referrerHost(raw string) string {
	u, err := url.Parse(raw)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") {
		return ""
	}
	host := strings.ToLower(u.Hostname())
	if len(host) > 253 {
		return ""
	}
	for _, c := range host {
		if !(c >= 'a' && c <= 'z' || c >= '0' && c <= '9' || c == '.' || c == '-' || c == ':') {
			return ""
		}
	}
	return host
}
func (a *analyticsCollector) service(id string) (analyticsService, bool) {
	a.mu.Lock()
	defer a.mu.Unlock()
	s, ok := a.services[id]
	return s, ok && time.Since(a.refreshed) < 2*time.Minute
}
func (a *analyticsCollector) add(cell AnalyticsCell) {
	service, ok := a.service(cell.AppID)
	if !ok {
		return
	}
	cell.Path = cleanPath(cell.Path)
	if strings.HasPrefix(cell.Path, "/.well-known/towbar-analytics") {
		return
	}
	decodedPath, _ := url.PathUnescape(cell.Path)
	for _, prefix := range service.ExcludePaths {
		if strings.HasPrefix(cell.Path, prefix) || strings.HasPrefix(decodedPath, prefix) {
			return
		}
	}
	if cell.Kind == "pageview" && !service.Pageviews {
		return
	}
	if !service.VisitorIdentity {
		cell.Visitor = ""
		cell.Session = ""
	}
	keyCell := cell
	keyCell.Count = 0
	keyCell.Bytes = 0
	keyCell.DurationMs = 0
	keyCell.Histogram = [11]int64{}
	keyBytes, _ := json.Marshal(keyCell)
	key := string(keyBytes)
	a.mu.Lock()
	defer a.mu.Unlock()
	a.expirePending(time.Now())
	prior, ok := a.cells[key]
	if !ok && len(a.cells) >= 512 {
		a.dropped++
		return
	}
	if !ok {
		prior = keyCell
	}
	if prior.Count >= 10_000_000 {
		a.dropped++
		return
	}
	prior.Count += cell.Count
	prior.Bytes += cell.Bytes
	prior.DurationMs += cell.DurationMs
	for i := range prior.Histogram {
		prior.Histogram[i] += cell.Histogram[i]
	}
	a.cells[key] = prior
}
func (a *analyticsCollector) flush(sample *Sample, q *Queue, now time.Time) error {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.tunnelPeers = sample.TunnelPeers
	a.peerCollectedAt = sample.CollectedAt
	sample.TunnelPeers = nil
	a.expirePending(now)
	for _, cell := range a.cells {
		sample.Analytics = append(sample.Analytics, cell)
	}
	sample.AnalyticsListenerReady = a.ready
	sample.AnalyticsDropped = a.dropped
	if a.geo != nil {
		sample.AnalyticsGeoBuiltAt = a.geo.builtAt()
	}
	if err := q.add(*sample, now); err != nil {
		return err
	}
	clear(a.cells)
	a.period = time.Time{}
	return nil
}
func (a *analyticsCollector) request(data []byte) {
	if !a.allowIngress() {
		return
	}
	var record struct {
		Referrer string  `json:"referrer"`
		Service  string  `json:"service"`
		Path     string  `json:"path"`
		Method   string  `json:"method"`
		Status   int     `json:"status"`
		Duration float64 `json:"duration"`
		Size     int64   `json:"size"`
	}
	if json.Unmarshal(data, &record) != nil || record.Status < 100 || record.Status > 599 || record.Duration < 0 || record.Size < 0 {
		return
	}
	switch record.Method {
	case "GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS":
	default:
		record.Method = "OTHER"
	}
	cell := AnalyticsCell{AppID: record.Service, Kind: "request", Referrer: referrerHost("https://" + record.Referrer), Path: record.Path, Method: record.Method, Status: record.Status, Count: 1, Bytes: record.Size, DurationMs: record.Duration * 1000}
	i := 0
	for i < len(latencyBounds) && cell.DurationMs > latencyBounds[i] {
		i++
	}
	cell.Histogram[i] = 1
	a.add(cell)
}
func (a *analyticsCollector) listen(ctx context.Context) error {
	socket, err := net.ListenPacket("udp4", "127.0.0.1:9468")
	if err != nil {
		return err
	}
	listener, err := net.Listen("tcp4", "127.0.0.1:9469")
	if err != nil {
		socket.Close()
		return err
	}
	server := &http.Server{Handler: http.HandlerFunc(a.browser), ReadHeaderTimeout: 3 * time.Second, ReadTimeout: 3 * time.Second, WriteTimeout: 3 * time.Second, IdleTimeout: 10 * time.Second, MaxHeaderBytes: 8192}
	go func() { <-ctx.Done(); socket.Close(); server.Close() }()
	go func() {
		buffer := make([]byte, 65536)
		for {
			n, _, err := socket.ReadFrom(buffer)
			if err != nil {
				return
			}
			a.request(buffer[:n])
		}
	}()
	a.mu.Lock()
	a.ready = true
	a.mu.Unlock()
	go server.Serve(listener)
	return nil
}
func hashIdentity(appID, value string) string {
	if len(value) != 32 {
		return ""
	}
	if _, err := hex.DecodeString(value); err != nil {
		return ""
	}
	sum := sha256.Sum256([]byte(appID + ":" + value))
	return hex.EncodeToString(sum[:])
}
func browserFamily(ua string) (string, string) {
	ua = strings.ToLower(ua)
	browser := "Other"
	device := "Desktop"
	switch {
	case strings.Contains(ua, "edg/"):
		browser = "Edge"
	case strings.Contains(ua, "firefox/"):
		browser = "Firefox"
	case strings.Contains(ua, "chrome/") || strings.Contains(ua, "crios/"):
		browser = "Chrome"
	case strings.Contains(ua, "safari/"):
		browser = "Safari"
	}
	switch {
	case strings.Contains(ua, "bot") || strings.Contains(ua, "crawler") || strings.Contains(ua, "spider"):
		device = "Bot"
	case strings.Contains(ua, "ipad") || strings.Contains(ua, "tablet"):
		device = "Tablet"
	case strings.Contains(ua, "mobile") || strings.Contains(ua, "android"):
		device = "Mobile"
	}
	return browser, device
}
func (a *analyticsCollector) browser(w http.ResponseWriter, r *http.Request) {
	if !a.allowIngress() {
		w.Header().Set("Retry-After", "1")
		http.Error(w, "Collection limit reached", 429)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	service, ok := a.service(r.Header.Get("X-Towbar-Service"))
	if !ok || !service.Pageviews || r.Host != service.Host {
		http.NotFound(w, r)
		return
	}
	if r.URL.Path == "/.well-known/towbar-analytics/script.js" && r.Method == "GET" {
		w.Header().Set("Content-Type", "application/javascript; charset=utf-8")
		fmt.Fprintf(w, browserScript, service.VisitorIdentity)
		return
	}
	if r.URL.Path != "/.well-known/towbar-analytics/event" || r.Method != "POST" {
		http.NotFound(w, r)
		return
	}
	origin, err := url.Parse(r.Header.Get("Origin"))
	if err != nil || origin.Scheme != "https" || origin.Host != service.Host || origin.User != nil {
		http.Error(w, "Invalid origin", 403)
		return
	}
	if r.Header.Get("DNT") == "1" || r.Header.Get("Sec-GPC") == "1" {
		w.WriteHeader(204)
		return
	}
	var event struct {
		Path     string `json:"path"`
		Referrer string `json:"referrer"`
		Visitor  string `json:"visitor"`
		Session  string `json:"session"`
	}
	reader := http.MaxBytesReader(w, r.Body, 2048)
	defer reader.Close()
	decoder := json.NewDecoder(reader)
	decoder.DisallowUnknownFields()
	if decoder.Decode(&event) != nil || len(event.Path) > 1024 || len(event.Referrer) > 1024 {
		http.Error(w, "Invalid event", 400)
		return
	}
	if err := decoder.Decode(new(any)); err != io.EOF {
		http.Error(w, "Invalid event", 400)
		return
	}
	browser, device := browserFamily(r.UserAgent())
	country := ""
	if a.geo != nil {
		country = a.geo.country(a.clientIP(service, r))
	}
	cell := AnalyticsCell{AppID: service.ID, Kind: "pageview", Path: event.Path, Referrer: referrerHost(event.Referrer), Method: "GET", Country: country, Browser: browser, Device: device, Count: 1}
	if service.VisitorIdentity {
		cell.Visitor = hashIdentity(service.ID, event.Visitor)
		cell.Session = hashIdentity(service.ID, event.Session)
	}
	a.add(cell)
	w.WriteHeader(204)
}
func (a *analyticsCollector) refresh(ctx context.Context, client *http.Client, c Config) (string, error) {
	endpoint := strings.TrimSuffix(c.Endpoint, "/metrics") + "/analytics/config"
	req, err := http.NewRequestWithContext(ctx, "GET", endpoint, nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("Authorization", "Bearer "+c.Token)
	req.Header.Set("X-Towbar-Server", c.ServerID)
	res, err := client.Do(req)
	if err != nil {
		return "", err
	}
	defer res.Body.Close()
	if res.StatusCode == 401 || res.StatusCode == 403 {
		return "", errRevoked
	}
	if res.StatusCode != 200 {
		return "", fmt.Errorf("analytics configuration unavailable")
	}
	var config analyticsConfig
	if err := json.NewDecoder(io.LimitReader(res.Body, 256*1024)).Decode(&config); err != nil {
		return "", err
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	clear(a.services)
	for _, service := range config.Services {
		a.services[service.ID] = service
	}
	a.refreshed = time.Now()
	return config.Refresh, nil
}

func (a *analyticsCollector) allowIngress() bool {
	a.mu.Lock()
	defer a.mu.Unlock()
	now := time.Now().Unix()
	if a.ingressWindow != now {
		a.ingressWindow = now
		a.ingressCount = 0
	}
	a.ingressCount++
	if a.ingressCount > 1000 {
		a.dropped++
		return false
	}
	return true
}

func (a *analyticsCollector) expirePending(now time.Time) {
	if a.period.IsZero() {
		a.period = now
	}
	if now.Sub(a.period) > time.Minute {
		for _, cell := range a.cells {
			a.dropped += uint64(cell.Count)
		}
		clear(a.cells)
		a.period = now
	}
}
