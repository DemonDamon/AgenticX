// LB policy helpers inspired by Higress ai-load-balancer (Apache-2.0); see NOTICE.
package channel

import (
	"hash/fnv"
	"os"
	"sort"
	"strconv"
	"strings"

	"github.com/agenticx/enterprise/gateway/internal/openai"
)

type LBPolicy string

const (
	LBWeight       LBPolicy = "weight"
	LBLatencyAware LBPolicy = "latency_aware"
	LBPrefixCache  LBPolicy = "prefix_cache"
)

// PickDecision records how a channel was selected for audit/observability.
type PickDecision struct {
	ChannelID string   `json:"channel_id"`
	Policy    LBPolicy `json:"policy"`
	Reason    string   `json:"reason"` // affinity|prefix|latency|weight
}

// LBPolicyFromEnv reads GATEWAY_AI_LB_POLICY; unknown values fall back to weight.
func LBPolicyFromEnv() LBPolicy {
	v := strings.ToLower(strings.TrimSpace(os.Getenv("GATEWAY_AI_LB_POLICY")))
	switch v {
	case string(LBLatencyAware), "latency-aware":
		return LBLatencyAware
	case string(LBPrefixCache), "prefix-cache":
		return LBPrefixCache
	default:
		return LBWeight
	}
}

// PrefixMsgsFromEnv reads GATEWAY_AI_LB_PREFIX_MSGS (default 4).
func PrefixMsgsFromEnv() int {
	raw := strings.TrimSpace(os.Getenv("GATEWAY_AI_LB_PREFIX_MSGS"))
	if raw == "" {
		return 4
	}
	n, err := strconv.Atoi(raw)
	if err != nil || n <= 0 {
		return 4
	}
	return n
}

// InverseLatencyWeight combines static channel weight with inverse p50 latency.
func InverseLatencyWeight(p50 int64, staticWeight int) int {
	w := staticWeight
	if w <= 0 {
		w = 1
	}
	if p50 <= 0 {
		return w
	}
	inv := int(10000 / p50)
	if inv < 1 {
		inv = 1
	}
	return w * inv
}

// PrefixHashIndex maps message prefix to a stable index in [0, count).
func PrefixHashIndex(messages []openai.ChatMessage, n, count int) int {
	if count <= 0 {
		return 0
	}
	prefix := extractPrefixContents(messages, n)
	if prefix == "" {
		return 0
	}
	h := fnv.New32a()
	_, _ = h.Write([]byte(prefix))
	return int(h.Sum32() % uint32(count))
}

func extractPrefixContents(messages []openai.ChatMessage, n int) string {
	if n <= 0 || len(messages) == 0 {
		return ""
	}
	if n > len(messages) {
		n = len(messages)
	}
	parts := make([]string, 0, n)
	for i := 0; i < n; i++ {
		content := strings.TrimSpace(openai.ComposeMessageContent(messages[i].Content, messages[i].ReasoningContent))
		if content != "" {
			parts = append(parts, content)
		}
	}
	return strings.Join(parts, "\n")
}

func stableSortedChannels(cands []Channel) []Channel {
	out := append([]Channel(nil), cands...)
	sort.Slice(out, func(i, j int) bool {
		return out[i].ID < out[j].ID
	})
	return out
}
