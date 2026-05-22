package cache

import (
	"encoding/json"
	"os"
	"strings"
	"time"
)

// AdminConfig is the admin-console persisted cache configuration.
type AdminConfig struct {
	L1Enabled         bool     `json:"l1_enabled"`
	L2Enabled         bool     `json:"l2_enabled"`
	L1TTLMinutes      int      `json:"l1_ttl_minutes"`
	SemanticThreshold float64  `json:"semantic_threshold"`
	ReplayMode        string   `json:"replay_mode"`
	ModelAllowlist    []string `json:"model_allowlist"`
	ModelBlocklist    []string `json:"model_blocklist"`
	L2EmbeddingModel  string   `json:"l2_embedding_model"`
	EvictPrefix       string   `json:"evict_prefix,omitempty"`
}

func LoadAdminConfig(path string) (AdminConfig, error) {
	var cfg AdminConfig
	raw, err := os.ReadFile(path)
	if err != nil {
		return cfg, err
	}
	err = json.Unmarshal(raw, &cfg)
	return cfg, err
}

func (a AdminConfig) Apply(base Config) Config {
	out := base
	out.L1Enabled = a.L1Enabled
	out.L2Enabled = a.L2Enabled
	if a.L1TTLMinutes > 0 {
		out.L1TTL = time.Duration(a.L1TTLMinutes) * time.Minute
	}
	if a.SemanticThreshold > 0 {
		out.SemanticThreshold = a.SemanticThreshold
	}
	if strings.EqualFold(a.ReplayMode, "real-time") {
		out.ReplayMode = ReplayRealTime
	} else if a.ReplayMode != "" {
		out.ReplayMode = ReplayBurst
	}
	if len(a.ModelAllowlist) > 0 {
		out.ModelAllowlist = sliceToSet(a.ModelAllowlist)
	}
	if len(a.ModelBlocklist) > 0 {
		out.ModelBlocklist = sliceToSet(a.ModelBlocklist)
	}
	if strings.TrimSpace(a.L2EmbeddingModel) != "" {
		out.L2EmbeddingModel = strings.TrimSpace(a.L2EmbeddingModel)
	}
	return out
}

func sliceToSet(items []string) map[string]struct{} {
	out := make(map[string]struct{}, len(items))
	for _, item := range items {
		item = strings.TrimSpace(item)
		if item != "" {
			out[item] = struct{}{}
		}
	}
	return out
}
