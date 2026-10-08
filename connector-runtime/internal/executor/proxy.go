package executor

import (
	"context"
	"net"
	"net/http"
	"net/url"
	"os"
	"strings"
	"sync"
	"time"
)

// 出网代理策略（与 Python agenticx/utils/proxy_policy.py 同一规则）：
//   - 本地目标（localhost/*.local/环回/私网/链路本地）永远直连；
//   - 远端目标遵循环境代理（HTTP(S)_PROXY / NO_PROXY）；
//   - 代理已配置但不可达（TCP 拨不通）时回落直连，探测结果缓存 30s。

const (
	proxyProbeTTL     = 30 * time.Second
	proxyProbeTimeout = 500 * time.Millisecond
)

type proxyProbe struct {
	at time.Time
	ok bool
}

var (
	proxyProbeMu    sync.Mutex
	proxyProbeCache = map[string]proxyProbe{}
	// envProxyFunc 读取环境代理（每次读取，测试可用 t.Setenv 切换）。
	envProxyFunc = func() func(*url.URL) (*url.URL, error) { return envProxyFor }
)

func getenvAny(keys ...string) string {
	for _, k := range keys {
		if v := strings.TrimSpace(os.Getenv(k)); v != "" {
			return v
		}
	}
	return ""
}

// envProxyFor 按 HTTPS_PROXY/HTTP_PROXY/ALL_PROXY 与 NO_PROXY 解析目标代理。
func envProxyFor(target *url.URL) (*url.URL, error) {
	var raw string
	if target.Scheme == "https" {
		raw = getenvAny("HTTPS_PROXY", "https_proxy", "ALL_PROXY", "all_proxy", "HTTP_PROXY", "http_proxy")
	} else {
		raw = getenvAny("HTTP_PROXY", "http_proxy", "ALL_PROXY", "all_proxy")
	}
	if raw == "" || noProxyMatch(target.Hostname(), getenvAny("NO_PROXY", "no_proxy")) {
		return nil, nil
	}
	if !strings.Contains(raw, "://") {
		raw = "http://" + raw
	}
	u, err := url.Parse(raw)
	if err != nil || u.Host == "" {
		return nil, nil
	}
	switch u.Scheme {
	case "http", "https", "socks5", "socks5h":
		return u, nil
	}
	return nil, nil
}

func noProxyMatch(host, list string) bool {
	host = strings.ToLower(host)
	for _, item := range strings.Split(list, ",") {
		item = strings.ToLower(strings.TrimSpace(item))
		if item == "" {
			continue
		}
		if item == "*" {
			return true
		}
		if strings.Contains(item, "/") {
			if _, n, err := net.ParseCIDR(item); err == nil {
				if ip := net.ParseIP(host); ip != nil && n.Contains(ip) {
					return true
				}
			}
			continue
		}
		if h, _, err := net.SplitHostPort(item); err == nil {
			item = h
		}
		item = strings.TrimPrefix(item, "*")
		bare := strings.TrimPrefix(item, ".")
		if host == bare || strings.HasSuffix(host, "."+bare) {
			return true
		}
	}
	return false
}

// isLocalHost 本地目标判定（主机名或 IP 字面量）。
func isLocalHost(host string) bool {
	h := strings.ToLower(strings.TrimSuffix(strings.Trim(host, "[]"), "."))
	if h == "" {
		return false
	}
	if h == "localhost" || strings.HasSuffix(h, ".localhost") || strings.HasSuffix(h, ".local") {
		return true
	}
	if i := strings.IndexByte(h, '%'); i >= 0 {
		h = h[:i]
	}
	ip := net.ParseIP(h)
	if ip == nil {
		return false
	}
	return ip.IsLoopback() || ip.IsPrivate() || ip.IsLinkLocalUnicast() || ip.IsUnspecified()
}

// proxyReachable 缓存的代理端点 TCP 探测。
func proxyReachable(hostport string) bool {
	proxyProbeMu.Lock()
	if p, ok := proxyProbeCache[hostport]; ok && time.Since(p.at) < proxyProbeTTL {
		proxyProbeMu.Unlock()
		return p.ok
	}
	proxyProbeMu.Unlock()
	ok := false
	if c, err := net.DialTimeout("tcp", hostport, proxyProbeTimeout); err == nil {
		_ = c.Close()
		ok = true
	}
	proxyProbeMu.Lock()
	proxyProbeCache[hostport] = proxyProbe{at: time.Now(), ok: ok}
	proxyProbeMu.Unlock()
	return ok
}

func proxyHostPort(u *url.URL) string {
	port := u.Port()
	if port == "" {
		switch u.Scheme {
		case "https":
			port = "443"
		case "socks5", "socks5h":
			port = "1080"
		default:
			port = "80"
		}
	}
	return net.JoinHostPort(u.Hostname(), port)
}

// policyProxy http.Transport.Proxy 实现。
func policyProxy(req *http.Request) (*url.URL, error) {
	if isLocalHost(req.URL.Hostname()) {
		return nil, nil
	}
	pu, err := envProxyFunc()(req.URL)
	if err != nil || pu == nil {
		return nil, nil
	}
	if !proxyReachable(proxyHostPort(pu)) {
		return nil, nil // 代理已配置但不可达：直连回落
	}
	if allow, _ := req.Context().Value(ctxAllowPrivate{}).(bool); !allow {
		// 经代理时拨号守护看不到目标 IP：先在本地解析一次，命中私网直接拒绝。
		if forbiddenByDNS(req.Context(), req.URL.Hostname()) {
			return nil, ssrfErrorf("目标 %s 解析到私网/保留地址，已被出网守护拦截", req.URL.Hostname())
		}
	}
	return pu, nil
}

func forbiddenByDNS(ctx context.Context, host string) bool {
	if ip := net.ParseIP(host); ip != nil {
		return isForbiddenIP(ip)
	}
	lctx, cancel := context.WithTimeout(ctx, 2*time.Second)
	defer cancel()
	addrs, err := net.DefaultResolver.LookupIPAddr(lctx, host)
	if err != nil {
		return false // 本地无法解析（纯代理网络）：交由代理解析
	}
	for _, a := range addrs {
		if isForbiddenIP(a.IP) {
			return true
		}
	}
	return false
}

// isConfiguredProxyAddr 拨号地址是否为当前配置的代理端点（守护放行代理自身，
// 例如 127.0.0.1:7897 的本机代理）。
func isConfiguredProxyAddr(address string) bool {
	for _, probe := range []string{"http://example.com", "https://example.com"} {
		u, _ := url.Parse(probe)
		pu, err := envProxyFunc()(u)
		if err != nil || pu == nil {
			continue
		}
		hp := proxyHostPort(pu)
		if hp == address {
			return true
		}
		// 代理主机名（如 localhost）解析后的 IP 形式
		if host, port, err := net.SplitHostPort(hp); err == nil {
			if ips, err := net.LookupIP(host); err == nil {
				for _, ip := range ips {
					if net.JoinHostPort(ip.String(), port) == address {
						return true
					}
				}
			}
		}
	}
	return false
}
