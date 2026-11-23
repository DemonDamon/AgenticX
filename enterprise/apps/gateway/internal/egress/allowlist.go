package egress

import (
	"net"
	"os"
	"strings"
)

// Allowlist 是逗号分隔的 CIDR、精确 IP 或主机名。主机名支持 *. 后缀。
type Allowlist struct {
	cidrs      []*net.IPNet
	ips        []net.IP
	exactHosts []string
	suffixes   []string
}

// AllowlistFromEnv 读取 GATEWAY_EGRESS_ALLOWLIST。构造期调用一次，不热更新。
func AllowlistFromEnv() *Allowlist {
	return ParseAllowlist(os.Getenv("GATEWAY_EGRESS_ALLOWLIST"))
}

// ParseAllowlist 解析允许列表。非法 CIDR 段被跳过。返回值永不为 nil。
func ParseAllowlist(raw string) *Allowlist {
	a := &Allowlist{}
	for _, part := range strings.Split(raw, ",") {
		item := strings.TrimSpace(part)
		if item == "" {
			continue
		}
		if strings.Contains(item, "/") {
			_, network, err := net.ParseCIDR(item)
			if err != nil {
				continue
			}
			a.cidrs = append(a.cidrs, network)
			continue
		}
		if ip := net.ParseIP(item); ip != nil {
			a.ips = append(a.ips, ip)
			continue
		}
		item = normalizeHost(item)
		if item == "" {
			continue
		}
		if strings.HasPrefix(item, "*.") {
			suffix := strings.TrimPrefix(item, "*.")
			if suffix != "" {
				a.suffixes = append(a.suffixes, suffix)
			}
			continue
		}
		a.exactHosts = append(a.exactHosts, item)
	}
	return a
}

// Match 判断主机名或解析后的 IP 是否在允许列表中。
// 主机名规则只看 host，CIDR 与精确 IP 只看 ip。
func (a *Allowlist) Match(host string, ip net.IP) bool {
	if a == nil {
		return false
	}
	host = normalizeHost(host)
	if ip != nil {
		for _, network := range a.cidrs {
			if network.Contains(ip) {
				return true
			}
		}
		for _, exact := range a.ips {
			if exact.Equal(ip) {
				return true
			}
		}
	}
	if host == "" {
		return false
	}
	for _, exact := range a.exactHosts {
		if host == exact {
			return true
		}
	}
	for _, suffix := range a.suffixes {
		if strings.HasSuffix(host, "."+suffix) {
			return true
		}
	}
	return false
}

func normalizeHost(host string) string {
	host = strings.TrimSpace(host)
	host = strings.TrimSuffix(host, ".")
	if i := strings.IndexByte(host, '%'); i >= 0 {
		host = host[:i]
	}
	return strings.ToLower(host)
}
