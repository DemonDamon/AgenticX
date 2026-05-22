package cache

import (
	"os"
	"strconv"
	"strings"
	"time"
)

// Config drives L1/L2 cache behavior from env and optional admin overrides.
type Config struct {
	L1Enabled            bool
	L2Enabled            bool
	L1TTL                time.Duration
	L2TTL                time.Duration
	SemanticThreshold    float64
	ReplayMode           ReplayMode
	CacheDiscountRatio   float64
	ModelAllowlist       map[string]struct{}
	ModelBlocklist       map[string]struct{}
	L2EmbeddingModel     string
	BypassTools          bool
}

func ConfigFromEnv() Config {
	cfg := Config{
		L1Enabled:          envOn("GATEWAY_CACHE_L1", true),
		L2Enabled:          envOn("GATEWAY_CACHE_L2", false),
		L1TTL:              envDuration("GATEWAY_CACHE_L1_TTL", 5*time.Minute),
		L2TTL:              envDuration("GATEWAY_CACHE_L2_TTL", time.Hour),
		SemanticThreshold:  envFloat("GATEWAY_CACHE_SEMANTIC_THRESHOLD", 0.92),
		ReplayMode:         ReplayBurst,
		CacheDiscountRatio: envFloat("GATEWAY_CACHE_DISCOUNT_RATIO", 0.1),
		BypassTools:        true,
	}
	if strings.EqualFold(strings.TrimSpace(os.Getenv("GATEWAY_CACHE_REPLAY_MODE")), "real-time") {
		cfg.ReplayMode = ReplayRealTime
	}
	if raw := strings.TrimSpace(os.Getenv("GATEWAY_CACHE_MODEL_ALLOWLIST")); raw != "" {
		cfg.ModelAllowlist = parseSet(raw)
	}
	if raw := strings.TrimSpace(os.Getenv("GATEWAY_CACHE_MODEL_BLOCKLIST")); raw != "" {
		cfg.ModelBlocklist = parseSet(raw)
	}
	cfg.L2EmbeddingModel = strings.TrimSpace(os.Getenv("GATEWAY_CACHE_L2_EMBEDDING_MODEL"))
	return cfg
}

func (c Config) ModelAllowed(model string) bool {
	model = strings.TrimSpace(model)
	if model == "" {
		return false
	}
	if len(c.ModelBlocklist) > 0 {
		if _, blocked := c.ModelBlocklist[model]; blocked {
			return false
		}
	}
	if len(c.ModelAllowlist) == 0 {
		return true
	}
	_, ok := c.ModelAllowlist[model]
	return ok
}

func parseSet(raw string) map[string]struct{} {
	out := make(map[string]struct{})
	for _, part := range strings.Split(raw, ",") {
		part = strings.TrimSpace(part)
		if part != "" {
			out[part] = struct{}{}
		}
	}
	return out
}

func envOn(key string, defaultOn bool) bool {
	raw := strings.TrimSpace(os.Getenv(key))
	if raw == "" {
		return defaultOn
	}
	switch strings.ToLower(raw) {
	case "1", "true", "on", "yes":
		return true
	case "0", "false", "off", "no":
		return false
	default:
		return defaultOn
	}
}

func envDuration(key string, fallback time.Duration) time.Duration {
	raw := strings.TrimSpace(os.Getenv(key))
	if raw == "" {
		return fallback
	}
	if d, err := time.ParseDuration(raw); err == nil {
		return d
	}
	if sec, err := strconv.Atoi(raw); err == nil {
		return time.Duration(sec) * time.Second
	}
	return fallback
}

func envFloat(key string, fallback float64) float64 {
	raw := strings.TrimSpace(os.Getenv(key))
	if raw == "" {
		return fallback
	}
	v, err := strconv.ParseFloat(raw, 64)
	if err != nil {
		return fallback
	}
	return v
}
