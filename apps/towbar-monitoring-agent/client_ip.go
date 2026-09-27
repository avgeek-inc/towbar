package main

import (
	"net"
	"net/http"
	"net/netip"
	"time"
)

// Published at https://www.cloudflare.com/ips-v4/ and /ips-v6/; verified
// 2026-09-27. New, unrecognized edge ranges fail closed until an agent update.
var cloudflareRanges = []netip.Prefix{
	netip.MustParsePrefix("173.245.48.0/20"), netip.MustParsePrefix("103.21.244.0/22"),
	netip.MustParsePrefix("103.22.200.0/22"), netip.MustParsePrefix("103.31.4.0/22"),
	netip.MustParsePrefix("141.101.64.0/18"), netip.MustParsePrefix("108.162.192.0/18"),
	netip.MustParsePrefix("190.93.240.0/20"), netip.MustParsePrefix("188.114.96.0/20"),
	netip.MustParsePrefix("197.234.240.0/22"), netip.MustParsePrefix("198.41.128.0/17"),
	netip.MustParsePrefix("162.158.0.0/15"), netip.MustParsePrefix("104.16.0.0/13"),
	netip.MustParsePrefix("104.24.0.0/14"), netip.MustParsePrefix("172.64.0.0/13"),
	netip.MustParsePrefix("131.0.72.0/22"), netip.MustParsePrefix("2400:cb00::/32"),
	netip.MustParsePrefix("2606:4700::/32"), netip.MustParsePrefix("2803:f800::/32"),
	netip.MustParsePrefix("2405:b500::/32"), netip.MustParsePrefix("2405:8100::/32"),
	netip.MustParsePrefix("2a06:98c0::/29"), netip.MustParsePrefix("2c0f:f248::/32"),
}

func isCloudflarePeer(raw string) bool {
	ip, err := netip.ParseAddr(raw)
	if err != nil {
		return false
	}
	for _, prefix := range cloudflareRanges {
		if prefix.Contains(ip.Unmap()) {
			return true
		}
	}
	return false
}
func (a *analyticsCollector) clientIP(service analyticsService, r *http.Request) string {
	peer := r.Header.Get("X-Towbar-Client-IP")
	trusted := false
	if service.CloudflareTunnel {
		a.mu.Lock()
		if time.Since(a.peerCollectedAt) < time.Minute {
			for _, ip := range a.tunnelPeers[service.ID] {
				if parsed := net.ParseIP(peer); parsed != nil && net.ParseIP(ip).Equal(parsed) {
					trusted = true
				}
			}
		}
		a.mu.Unlock()
	} else if service.CloudflareProxy {
		trusted = isCloudflarePeer(peer)
	}
	if service.CloudflareProxy || service.CloudflareTunnel {
		if !trusted {
			return ""
		}
		client := r.Header.Get("X-Towbar-CF-IP")
		if ipv6 := r.Header.Get("X-Towbar-CF-IPv6"); ipv6 != "" {
			if ip := net.ParseIP(ipv6); ip != nil && ip.To4() == nil {
				client = ipv6
			} else {
				return ""
			}
		}
		if net.ParseIP(client) == nil || isCloudflarePeer(client) {
			return ""
		}
		return client
	}
	if isCloudflarePeer(peer) {
		return ""
	}
	return peer
}
