package server

import (
	"fmt"
	"net"
	"net/http"
	"net/netip"
	"strings"
)

func parseTrustedProxies(entries []string) ([]netip.Prefix, error) {
	var result []netip.Prefix
	for _, entry := range entries {
		entry = strings.TrimSpace(entry)
		prefix, err := netip.ParsePrefix(entry)
		if err != nil {
			address, addressErr := netip.ParseAddr(entry)
			if addressErr != nil || address.Zone() != "" {
				return nil, fmt.Errorf("invalid trusted proxy address %q", entry)
			}
			prefix = netip.PrefixFrom(address, address.BitLen())
		}
		if prefix.Addr().Is4In6() {
			if prefix.Bits() < 96 {
				return nil, fmt.Errorf("invalid mapped IPv4 trusted proxy prefix %q", entry)
			}
			prefix = netip.PrefixFrom(prefix.Addr().Unmap(), prefix.Bits()-96)
		}
		if prefix.Bits() == 0 {
			return nil, fmt.Errorf("trusted proxies must not include all addresses: %q", entry)
		}
		result = append(result, prefix.Masked())
	}
	return result, nil
}

func proxyAddress(value string) (netip.Addr, bool) {
	value = strings.TrimSpace(value)
	if host, _, err := net.SplitHostPort(value); err == nil {
		value = host
	}
	address, err := netip.ParseAddr(value)
	return address.Unmap(), err == nil && address.Zone() == ""
}

// trustedProxyRealIP changes RemoteAddr only when the socket peer is trusted.
// Every address to the left of the first untrusted hop is client-supplied data.
func trustedProxyRealIP(prefixes []netip.Prefix) func(http.Handler) http.Handler {
	isTrusted := func(address netip.Addr) bool {
		for _, prefix := range prefixes {
			if prefix.Contains(address) {
				return true
			}
		}
		return false
	}
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			peer, valid := proxyAddress(r.RemoteAddr)
			if !valid || !isTrusted(peer) {
				next.ServeHTTP(w, r)
				return
			}
			values := r.Header.Values("X-Forwarded-For")
			if len(values) == 0 {
				values = r.Header.Values("X-Real-IP")
				if len(values) != 1 || strings.Contains(values[0], ",") {
					next.ServeHTTP(w, r)
					return
				}
			}
			var hops []netip.Addr
			for _, value := range values {
				for _, part := range strings.Split(value, ",") {
					address, err := netip.ParseAddr(strings.TrimSpace(part))
					if err != nil || address.Zone() != "" {
						next.ServeHTTP(w, r)
						return
					}
					hops = append(hops, address.Unmap())
				}
			}
			client := peer
			for index := len(hops) - 1; index >= 0 && isTrusted(client); index-- {
				client = hops[index]
			}
			r.RemoteAddr = client.String()
			next.ServeHTTP(w, r)
		})
	}
}
