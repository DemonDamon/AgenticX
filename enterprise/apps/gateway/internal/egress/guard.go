package egress

import (
	"context"
	"errors"
	"fmt"
	"net"
	"net/http"
	"os"
	"strings"
)

// Mode 是出站守护的运行模式。
type Mode string

const (
	ModeOff     Mode = "off"
	ModeAudit   Mode = "audit"
	ModeEnforce Mode = "enforce"
)

// Decision 是一次地址判定的结果。Blocked 与 WouldBlock 互斥。
type Decision struct {
	Host       string
	IP         net.IP
	Blocked    bool
	WouldBlock bool
	Reason     string // "metadata" | "restricted" | ""
}

// ErrForbidden 是拨号被拒绝时的错误。文本固定为 egress:forbidden。
var ErrForbidden = errors.New("egress:forbidden")

// Resolver 把主机名解析成 IP。测试注入它，避免依赖真实 DNS。
type Resolver func(ctx context.Context, network, host string) ([]net.IP, error)

type dialFunc func(ctx context.Context, network, address string) (net.Conn, error)

// overrideDial 仅供同包测试替换真实拨号。生产路径保持 nil。
var overrideDial dialFunc

var (
	metadataV4 = net.IPv4(169, 254, 169, 254)
	metadataV6 = net.ParseIP("fd00:ec2::254")
)

// ModeFromEnv 读取 GATEWAY_EGRESS_GUARD_MODE。空值与无法识别的值都是 audit。
func ModeFromEnv() Mode {
	switch strings.ToLower(strings.TrimSpace(os.Getenv("GATEWAY_EGRESS_GUARD_MODE"))) {
	case "off":
		return ModeOff
	case "enforce":
		return ModeEnforce
	default:
		return ModeAudit
	}
}

// Decide 只做地址判定，不拨号。
func Decide(mode Mode, allow *Allowlist, host string, ip net.IP) Decision {
	d := Decision{Host: host, IP: ip}
	if mode == ModeOff {
		return d
	}
	if isMetadata(ip) {
		d.Blocked = true
		d.Reason = "metadata"
		return d
	}
	if ip != nil && isRestricted(ip) {
		if allow.Match(host, ip) {
			return d
		}
		d.Reason = "restricted"
		if mode == ModeAudit {
			d.WouldBlock = true
			return d
		}
		d.Blocked = true
		return d
	}
	return d
}

func isMetadata(ip net.IP) bool {
	if ip == nil {
		return false
	}
	if v4 := ip.To4(); v4 != nil {
		return v4.Equal(metadataV4.To4())
	}
	return ip.Equal(metadataV6)
}

func isRestricted(ip net.IP) bool {
	return ip.IsLoopback() || ip.IsPrivate() || ip.IsLinkLocalUnicast() || ip.IsUnspecified()
}

// NewHTTPClient 在 base 的拨号路径上安装守护。不修改 base 本身。
func NewHTTPClient(base *http.Client, mode Mode, allow *Allowlist, onDecision func(Decision)) *http.Client {
	return NewHTTPClientWithResolver(base, mode, allow, nil, onDecision)
}

// NewHTTPClientWithResolver 与 NewHTTPClient 相同，但主机名解析可注入。
func NewHTTPClientWithResolver(base *http.Client, mode Mode, allow *Allowlist, resolver Resolver, onDecision func(Decision)) *http.Client {
	return newHTTPClient(base, mode, allow, resolver, onDecision, overrideDial)
}

func newHTTPClient(base *http.Client, mode Mode, allow *Allowlist, resolver Resolver, onDecision func(Decision), dial dialFunc) *http.Client {
	if base == nil {
		base = &http.Client{}
	}
	cloned := *base
	transport := cloneTransport(base.Transport)
	g := &guard{
		mode:       mode,
		allow:      allow,
		resolver:   resolver,
		onDecision: onDecision,
		dial:       dial,
	}
	transport.DialContext = g.dialContext
	cloned.Transport = transport
	return &cloned
}

func cloneTransport(rt http.RoundTripper) *http.Transport {
	switch t := rt.(type) {
	case *http.Transport:
		return t.Clone()
	case nil:
		if dt, ok := http.DefaultTransport.(*http.Transport); ok {
			return dt.Clone()
		}
		return &http.Transport{}
	default:
		return &http.Transport{}
	}
}

type guard struct {
	mode       Mode
	allow      *Allowlist
	resolver   Resolver
	onDecision func(Decision)
	dial       dialFunc
}

func (g *guard) dialContext(ctx context.Context, network, address string) (net.Conn, error) {
	host, port, err := net.SplitHostPort(address)
	if err != nil {
		return nil, err
	}
	host = strings.TrimSuffix(host, ".")
	ips, err := g.lookup(ctx, network, host)
	if err != nil {
		return nil, err
	}
	chosen, decision, forbid := g.choose(host, network, ips)
	if chosen == nil && !forbid {
		return nil, fmt.Errorf("egress: no suitable address for %s", host)
	}
	if g.onDecision != nil && (decision.Blocked || decision.WouldBlock) {
		g.onDecision(decision)
	}
	if forbid || decision.Blocked {
		return nil, ErrForbidden
	}
	target := net.JoinHostPort(chosen.String(), port)
	dial := g.dial
	if dial == nil {
		dial = func(ctx context.Context, network, address string) (net.Conn, error) {
			return (&net.Dialer{}).DialContext(ctx, network, address)
		}
	}
	return dial(ctx, dialNetwork(network, chosen), target)
}

func (g *guard) lookup(ctx context.Context, network, host string) ([]net.IP, error) {
	if ip := parseIP(host); ip != nil {
		return []net.IP{ip}, nil
	}
	resolver := g.resolver
	if resolver == nil {
		resolver = defaultResolver
	}
	return resolver(ctx, network, host)
}

func (g *guard) choose(host, network string, ips []net.IP) (net.IP, Decision, bool) {
	var firstAllowed net.IP
	var would Decision
	sawWould := false
	for _, ip := range ips {
		if ip == nil || !ipMatchesNetwork(ip, network) {
			continue
		}
		d := Decide(g.mode, g.allow, host, ip)
		if d.Blocked {
			return ip, d, true
		}
		if d.WouldBlock && !sawWould {
			would = d
			sawWould = true
		}
		if firstAllowed == nil {
			firstAllowed = ip
		}
	}
	if firstAllowed == nil {
		return nil, Decision{}, false
	}
	if sawWould {
		return firstAllowed, would, false
	}
	return firstAllowed, Decision{Host: host, IP: firstAllowed}, false
}

func defaultResolver(ctx context.Context, network, host string) ([]net.IP, error) {
	lookupNet := "ip"
	switch network {
	case "tcp4", "udp4":
		lookupNet = "ip4"
	case "tcp6", "udp6":
		lookupNet = "ip6"
	}
	return net.DefaultResolver.LookupIP(ctx, lookupNet, host)
}

func parseIP(host string) net.IP {
	if i := strings.IndexByte(host, '%'); i >= 0 {
		host = host[:i]
	}
	return net.ParseIP(host)
}

func ipMatchesNetwork(ip net.IP, network string) bool {
	switch network {
	case "tcp4", "udp4", "ip4":
		return ip.To4() != nil
	case "tcp6", "udp6", "ip6":
		return ip.To4() == nil
	default:
		return true
	}
}

func dialNetwork(network string, ip net.IP) string {
	v4 := ip.To4() != nil
	switch network {
	case "tcp", "tcp4", "tcp6":
		if v4 {
			return "tcp4"
		}
		return "tcp6"
	case "udp", "udp4", "udp6":
		if v4 {
			return "udp4"
		}
		return "udp6"
	default:
		return network
	}
}
