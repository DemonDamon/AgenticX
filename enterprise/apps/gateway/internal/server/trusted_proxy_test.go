package server

import (
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/agenticx/enterprise/gateway/internal/config"
	"github.com/go-chi/chi/v5"
)

func TestTrustedProxyRealIP(t *testing.T) {
	prefixes, err := parseTrustedProxies([]string{"192.0.2.10", "198.51.100.0/24", "2001:db8:1::/48"})
	if err != nil {
		t.Fatal(err)
	}
	for _, tt := range []struct {
		name, peer string
		headers    http.Header
		want       string
	}{
		{"direct spoof", "203.0.113.5:1234", http.Header{"X-Forwarded-For": {"1.1.1.1"}, "True-Client-Ip": {"2.2.2.2"}}, "203.0.113.5:1234"},
		{"trusted peer with spoof prefix", "192.0.2.10:1234", http.Header{"X-Forwarded-For": {"1.1.1.1, 203.0.113.5"}}, "203.0.113.5"},
		{"multiple and repeated hops", "192.0.2.10:1234", http.Header{"X-Forwarded-For": {"1.1.1.1, 203.0.113.5", "198.51.100.2"}}, "203.0.113.5"},
		{"invalid chain", "192.0.2.10:1234", http.Header{"X-Forwarded-For": {"bad, 203.0.113.5"}}, "192.0.2.10:1234"},
		{"empty chain", "192.0.2.10:1234", http.Header{"X-Forwarded-For": {""}, "X-Real-Ip": {"203.0.113.5"}}, "192.0.2.10:1234"},
		{"xff precedence", "192.0.2.10:1234", http.Header{"X-Forwarded-For": {"203.0.113.5"}, "X-Real-Ip": {"1.1.1.1"}}, "203.0.113.5"},
		{"real ip fallback", "192.0.2.10:1234", http.Header{"X-Real-Ip": {"203.0.113.5"}}, "203.0.113.5"},
		{"duplicate real ip ignored", "192.0.2.10:1234", http.Header{"X-Real-Ip": {"203.0.113.5", "1.1.1.1"}}, "192.0.2.10:1234"},
		{"ipv6 and mapped ipv4", "[2001:db8:1::1]:1234", http.Header{"X-Forwarded-For": {"::ffff:203.0.113.5"}}, "203.0.113.5"},
		{"mapped peer", "[::ffff:192.0.2.10]:1234", http.Header{"X-Forwarded-For": {"203.0.113.5"}}, "203.0.113.5"},
		{"zoned address rejected", "192.0.2.10:1234", http.Header{"X-Forwarded-For": {"fe80::1%lo0"}}, "192.0.2.10:1234"},
		{"unknown peer", "unknown", http.Header{"X-Forwarded-For": {"203.0.113.5"}}, "unknown"},
	} {
		t.Run(tt.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodGet, "/", nil)
			req.RemoteAddr, req.Header = tt.peer, tt.headers
			got := ""
			trustedProxyRealIP(prefixes)(http.HandlerFunc(func(_ http.ResponseWriter, r *http.Request) { got = r.RemoteAddr })).ServeHTTP(httptest.NewRecorder(), req)
			if got != tt.want {
				t.Fatalf("got %q want %q", got, tt.want)
			}
		})
	}
}

func TestTrustedProxyDefaultAndRouterIntegration(t *testing.T) {
	for _, configured := range []bool{false, true} {
		s := &Server{logger: slog.New(slog.NewTextHandler(io.Discard, nil))}
		if configured {
			s.trustedProxies, _ = parseTrustedProxies([]string{"192.0.2.10"})
		}
		router := s.Router().(chi.Router)
		router.Get("/test-client-address", func(w http.ResponseWriter, r *http.Request) { _, _ = io.WriteString(w, r.RemoteAddr) })
		req := httptest.NewRequest(http.MethodGet, "/test-client-address", nil)
		req.RemoteAddr = "192.0.2.10:1234"
		req.Header.Set("X-Forwarded-For", "203.0.113.5")
		recorder := httptest.NewRecorder()
		router.ServeHTTP(recorder, req)
		want := "192.0.2.10:1234"
		if configured {
			want = "203.0.113.5"
		}
		if recorder.Body.String() != want {
			t.Fatalf("configured=%v got=%q want=%q", configured, recorder.Body.String(), want)
		}
	}
}

func TestInvalidTrustedProxiesPreventStartup(t *testing.T) {
	for _, input := range []string{"garbage", "", "0.0.0.0/0", "::/0", "::ffff:0:0/80", "::ffff:0:0/96", "fe80::1%lo0"} {
		t.Run(input, func(t *testing.T) {
			_, err := New(config.Config{TrustedProxyCIDRs: []string{input}}, slog.New(slog.NewTextHandler(io.Discard, nil)))
			if err == nil {
				t.Fatalf("expected invalid trusted proxy %q to prevent startup", input)
			}
		})
	}
	if result, err := parseTrustedProxies(nil); err != nil || len(result) != 0 {
		t.Fatalf("empty config=%v err=%v", result, err)
	}
	if result, err := parseTrustedProxies([]string{"::ffff:192.0.2.0/120"}); err != nil || len(result) != 1 || result[0].String() != "192.0.2.0/24" {
		t.Fatalf("mapped prefix=%v err=%v", result, err)
	}
}
