package config

import (
	"errors"
	"os"
	"strings"

	"gopkg.in/yaml.v3"
)

type ModelRoute struct {
	Name     string `yaml:"name"`
	Provider string `yaml:"provider"`
	Route    string `yaml:"route"`
	Endpoint string `yaml:"endpoint"`
}

type Config struct {
	HTTPAddr         string       `yaml:"http_addr"`
	DefaultRoute     string       `yaml:"default_route"`
	LocalRouteHeader string       `yaml:"local_route_header"`
	Models           []ModelRoute `yaml:"models"`
	PolicyManifest   string       `yaml:"policy_manifest"`
	AuditDir         string       `yaml:"audit_dir"`
}

func defaultConfig() Config {
	return Config{
		HTTPAddr:         ":8088",
		DefaultRoute:     "third-party",
		LocalRouteHeader: "x-agenticx-route",
		PolicyManifest:   "../../plugins/moderation-*/manifest.yaml",
		AuditDir:         "./.runtime/audit",
		Models: []ModelRoute{
			{Name: "deepseek-chat", Provider: "deepseek", Route: "third-party", Endpoint: "https://api.deepseek.com/v1"},
			{Name: "moonshot-v1-8k", Provider: "moonshot", Route: "private-cloud", Endpoint: "https://api.moonshot.cn/v1"},
			{Name: "local-ollama-llama3", Provider: "edge-agent", Route: "local", Endpoint: "http://127.0.0.1:11434/v1"},
		},
	}
}

func Load() (Config, error) {
	cfg := defaultConfig()
	path := strings.TrimSpace(os.Getenv("GATEWAY_CONFIG_PATH"))
	if path == "" {
		if addr := strings.TrimSpace(os.Getenv("GATEWAY_HTTP_ADDR")); addr != "" {
			cfg.HTTPAddr = addr
		}
		return cfg, nil
	}

	content, err := os.ReadFile(path)
	if err != nil {
		return Config{}, err
	}
	if err := yaml.Unmarshal(content, &cfg); err != nil {
		return Config{}, err
	}
	if cfg.HTTPAddr == "" {
		return Config{}, errors.New("http_addr is required")
	}
	if cfg.LocalRouteHeader == "" {
		cfg.LocalRouteHeader = "x-agenticx-route"
	}
	if cfg.DefaultRoute == "" {
		cfg.DefaultRoute = "third-party"
	}
	if cfg.AuditDir == "" {
		cfg.AuditDir = "./.runtime/audit"
	}
	return cfg, nil
}
