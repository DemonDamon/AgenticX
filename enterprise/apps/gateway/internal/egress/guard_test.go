package egress

import (
	"context"
	"errors"
	"net"
	"net/http"
	"testing"
	"time"
)

func TestDecideModes(t *testing.T) {
	cases := []struct {
		name    string
		ip      string
		mode    Mode
		allow   string
		blocked bool
		would   bool
		reason  string
	}{
		{name: "loopback-off", ip: "127.0.0.1", mode: ModeOff},
		{name: "loopback-audit", ip: "127.0.0.1", mode: ModeAudit, would: true, reason: "restricted"},
		{name: "loopback-enforce", ip: "127.0.0.1", mode: ModeEnforce, blocked: true, reason: "restricted"},
		{name: "private-off", ip: "10.0.0.5", mode: ModeOff},
		{name: "private-audit", ip: "10.0.0.5", mode: ModeAudit, would: true, reason: "restricted"},
		{name: "private-enforce", ip: "10.0.0.5", mode: ModeEnforce, blocked: true, reason: "restricted"},
		{name: "v6loop-off", ip: "::1", mode: ModeOff},
		{name: "v6loop-audit", ip: "::1", mode: ModeAudit, would: true, reason: "restricted"},
		{name: "v6loop-enforce", ip: "::1", mode: ModeEnforce, blocked: true, reason: "restricted"},
		{name: "metadata-v4-off", ip: "169.254.169.254", mode: ModeOff},
		{name: "metadata-v4-audit", ip: "169.254.169.254", mode: ModeAudit, blocked: true, reason: "metadata"},
		{name: "metadata-v4-enforce", ip: "169.254.169.254", mode: ModeEnforce, blocked: true, reason: "metadata"},
		{name: "metadata-v4-audit-allowlisted", ip: "169.254.169.254", mode: ModeAudit, allow: "169.254.169.254/32", blocked: true, reason: "metadata"},
		{name: "metadata-v4-enforce-allowlisted", ip: "169.254.169.254", mode: ModeEnforce, allow: "169.254.169.254/32", blocked: true, reason: "metadata"},
		{name: "metadata-v6-off", ip: "fd00:ec2::254", mode: ModeOff},
		{name: "metadata-v6-audit", ip: "fd00:ec2::254", mode: ModeAudit, blocked: true, reason: "metadata"},
		{name: "metadata-v6-enforce", ip: "fd00:ec2::254", mode: ModeEnforce, blocked: true, reason: "metadata"},
		{name: "metadata-v6-enforce-allowlisted", ip: "fd00:ec2::254", mode: ModeEnforce, allow: "fd00:ec2::254/128", blocked: true, reason: "metadata"},
		{name: "mapped-metadata-audit", ip: "::ffff:169.254.169.254", mode: ModeAudit, blocked: true, reason: "metadata"},
		{name: "allow-cidr-off", ip: "10.1.2.3", mode: ModeOff, allow: "10.1.0.0/16"},
		{name: "allow-cidr-audit", ip: "10.1.2.3", mode: ModeAudit, allow: "10.1.0.0/16"},
		{name: "allow-cidr-enforce", ip: "10.1.2.3", mode: ModeEnforce, allow: "10.1.0.0/16"},
		{name: "public-off", ip: "93.184.216.34", mode: ModeOff},
		{name: "public-audit", ip: "93.184.216.34", mode: ModeAudit},
		{name: "public-enforce", ip: "93.184.216.34", mode: ModeEnforce},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			var allow *Allowlist
			if tc.allow != "" {
				allow = ParseAllowlist(tc.allow)
			}
			got := Decide(tc.mode, allow, "host.test", net.ParseIP(tc.ip))
			if got.Blocked != tc.blocked || got.WouldBlock != tc.would || got.Reason != tc.reason {
				t.Fatalf("Decide(%s, %s) = blocked=%v would=%v reason=%q, want blocked=%v would=%v reason=%q",
					tc.mode, tc.ip, got.Blocked, got.WouldBlock, got.Reason, tc.blocked, tc.would, tc.reason)
			}
			if got.Blocked && got.WouldBlock {
				t.Fatal("Blocked and WouldBlock are both true")
			}
		})
	}
}

func TestAllowlistHostPatterns(t *testing.T) {
	a := ParseAllowlist("*.corp.example,10.0.0.0/8,bad/99")
	if !a.Match("a.corp.example", net.ParseIP("1.2.3.4")) {
		t.Fatal("expected suffix match for a.corp.example")
	}
	if !a.Match("a.b.corp.example", net.ParseIP("1.2.3.4")) {
		t.Fatal("expected nested suffix match")
	}
	if !a.Match("Foo.CORP.Example", net.ParseIP("8.8.8.8")) {
		t.Fatal("expected case-insensitive suffix match")
	}
	if a.Match("corp.example", net.ParseIP("1.2.3.4")) {
		t.Fatal("apex name must not match *.corp.example")
	}
	if a.Match("evilcorp.example", net.ParseIP("1.2.3.4")) {
		t.Fatal("evilcorp.example must not match *.corp.example")
	}
	if !a.Match("other.example", net.ParseIP("10.1.2.3")) {
		t.Fatal("expected 10.0.0.0/8 to match 10.1.2.3")
	}
	if a.Match("other.example", net.ParseIP("11.0.0.1")) {
		t.Fatal("11.0.0.1 is outside 10.0.0.0/8 and the host is not listed")
	}
}

func TestModeFromEnv(t *testing.T) {
	cases := []struct {
		raw  string
		want Mode
	}{
		{raw: "", want: ModeAudit},
		{raw: "audit", want: ModeAudit},
		{raw: "AUDIT", want: ModeAudit},
		{raw: "enforce", want: ModeEnforce},
		{raw: "off", want: ModeOff},
		{raw: "nope", want: ModeAudit},
	}
	for _, tc := range cases {
		t.Run(tc.raw, func(t *testing.T) {
			t.Setenv("GATEWAY_EGRESS_GUARD_MODE", tc.raw)
			if got := ModeFromEnv(); got != tc.want {
				t.Fatalf("ModeFromEnv(%q) = %q, want %q", tc.raw, got, tc.want)
			}
		})
	}
}

func TestDialUsesInjectedResolverNotDNS(t *testing.T) {
	clearProxyEnv(t)
	var lookups int
	var dials int
	prev := overrideDial
	overrideDial = func(ctx context.Context, network, address string) (net.Conn, error) {
		dials++
		return nil, errors.New("dialed")
	}
	t.Cleanup(func() { overrideDial = prev })

	resolver := func(ctx context.Context, network, host string) ([]net.IP, error) {
		lookups++
		if host != "rebind.test" {
			t.Fatalf("resolver host %q", host)
		}
		return []net.IP{net.ParseIP("169.254.169.254")}, nil
	}
	client := NewHTTPClientWithResolver(&http.Client{Timeout: 2 * time.Second}, ModeEnforce, nil, resolver, nil)
	req, err := http.NewRequest(http.MethodGet, "http://rebind.test/latest", nil)
	if err != nil {
		t.Fatal(err)
	}
	_, err = client.Do(req)
	if !errors.Is(err, ErrForbidden) {
		t.Fatalf("err = %v, want egress:forbidden", err)
	}
	if lookups == 0 {
		t.Fatal("resolver was not called")
	}
	if dials != 0 {
		t.Fatalf("dial called %d times", dials)
	}
}

func TestDialConnectsToResolvedIP(t *testing.T) {
	clearProxyEnv(t)
	var dialed []string
	prev := overrideDial
	overrideDial = func(ctx context.Context, network, address string) (net.Conn, error) {
		dialed = append(dialed, address)
		return nil, errors.New("stop")
	}
	t.Cleanup(func() { overrideDial = prev })

	resolver := func(ctx context.Context, network, host string) ([]net.IP, error) {
		switch host {
		case "name.test":
			return []net.IP{net.ParseIP("10.0.0.5")}, nil
		case "public.test":
			return []net.IP{net.ParseIP("93.184.216.34")}, nil
		default:
			t.Fatalf("unexpected host %s", host)
			return nil, nil
		}
	}

	var decisions []Decision
	auditClient := NewHTTPClientWithResolver(&http.Client{Timeout: 2 * time.Second}, ModeAudit, nil, resolver, func(d Decision) {
		decisions = append(decisions, d)
	})
	req, err := http.NewRequest(http.MethodGet, "http://name.test/x", nil)
	if err != nil {
		t.Fatal(err)
	}
	_, _ = auditClient.Do(req)
	if len(dialed) != 1 || dialed[0] != "10.0.0.5:80" {
		t.Fatalf("dialed %#v, want 10.0.0.5:80", dialed)
	}
	if len(decisions) != 1 || !decisions[0].WouldBlock || decisions[0].Blocked {
		t.Fatalf("decisions %#v", decisions)
	}

	dialed = nil
	decisions = nil
	publicClient := NewHTTPClientWithResolver(&http.Client{Timeout: 2 * time.Second}, ModeAudit, nil, resolver, func(d Decision) {
		decisions = append(decisions, d)
	})
	req, err = http.NewRequest(http.MethodGet, "http://public.test:8080/x", nil)
	if err != nil {
		t.Fatal(err)
	}
	_, _ = publicClient.Do(req)
	if len(dialed) != 1 || dialed[0] != "93.184.216.34:8080" {
		t.Fatalf("dialed %#v, want 93.184.216.34:8080", dialed)
	}
	if len(decisions) != 0 {
		t.Fatalf("public dial should not callback, got %#v", decisions)
	}
}

func clearProxyEnv(t *testing.T) {
	t.Helper()
	for _, key := range []string{"HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy", "NO_PROXY", "no_proxy"} {
		t.Setenv(key, "")
	}
}
