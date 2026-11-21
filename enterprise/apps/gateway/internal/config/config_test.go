package config

import (
	"os"
	"path/filepath"
	"reflect"
	"testing"
)

func TestTrustedProxyConfigurationSources(t *testing.T) {
	t.Setenv("GATEWAY_CONFIG_PATH", "")
	t.Setenv("GATEWAY_TRUSTED_PROXY_CIDRS", "192.0.2.10, 2001:db8::/48")
	cfg, err := Load()
	if err != nil || !reflect.DeepEqual(cfg.TrustedProxyCIDRs, []string{"192.0.2.10", " 2001:db8::/48"}) {
		t.Fatalf("environment: config=%+v err=%v", cfg, err)
	}
	path := filepath.Join(t.TempDir(), "gateway.yaml")
	if err := os.WriteFile(path, []byte("http_addr: ':8088'\ntrusted_proxy_cidrs:\n  - '198.51.100.0/24'\n"), 0600); err != nil {
		t.Fatal(err)
	}
	t.Setenv("GATEWAY_CONFIG_PATH", path)
	if err := os.Unsetenv("GATEWAY_TRUSTED_PROXY_CIDRS"); err != nil {
		t.Fatal(err)
	}
	cfg, err = Load()
	if err != nil || !reflect.DeepEqual(cfg.TrustedProxyCIDRs, []string{"198.51.100.0/24"}) {
		t.Fatalf("yaml: config=%+v err=%v", cfg, err)
	}
	t.Setenv("GATEWAY_TRUSTED_PROXY_CIDRS", "192.0.2.20")
	cfg, err = Load()
	if err != nil || !reflect.DeepEqual(cfg.TrustedProxyCIDRs, []string{"192.0.2.20"}) {
		t.Fatalf("override: config=%+v err=%v", cfg, err)
	}
	t.Setenv("GATEWAY_TRUSTED_PROXY_CIDRS", "")
	cfg, err = Load()
	if err != nil || len(cfg.TrustedProxyCIDRs) != 0 {
		t.Fatalf("explicit disable: config=%+v err=%v", cfg, err)
	}
}
