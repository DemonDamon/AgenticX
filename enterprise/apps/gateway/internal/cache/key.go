package cache

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"sort"
	"strings"

	"github.com/agenticx/enterprise/gateway/internal/openai"
)

// CanonicalKey materializes a stable cache key from tenant/user/model and request body.
func CanonicalKey(tenantID, userID, model string, req openai.ChatCompletionRequest) (hash string, bypass bool, reason string) {
	if strings.TrimSpace(tenantID) == "" {
		return "", true, "missing_tenant"
	}
	if ShouldBypass(req) {
		return "", true, "bypass_rules"
	}
	payload := map[string]any{
		"tenant_id": strings.TrimSpace(tenantID),
		"user_id":   strings.TrimSpace(userID),
		"model":     strings.TrimSpace(model),
		"messages":  normalizeMessages(req.Messages),
		"system":    strings.TrimSpace(req.System),
		"tools":     req.Tools,
		"tool_choice": req.ToolChoice,
		"temperature": req.Temperature,
		"top_p":       req.TopP,
		"max_tokens":  firstNonZero(req.MaxTokens, req.MaxCompletionTokens),
		"stop":        req.Stop,
	}
	raw, err := json.Marshal(payload)
	if err != nil {
		return "", true, "marshal_failed"
	}
	sum := sha256.Sum256(raw)
	return hex.EncodeToString(sum[:]), false, ""
}

func normalizeMessages(messages []openai.ChatMessage) []map[string]string {
	out := make([]map[string]string, 0, len(messages))
	for _, msg := range messages {
		out = append(out, map[string]string{
			"role":    strings.TrimSpace(msg.Role),
			"content": strings.TrimSpace(openai.ComposeMessageContent(msg.Content, msg.ReasoningContent)),
		})
	}
	sort.SliceStable(out, func(i, j int) bool {
		a := out[i]["role"] + out[i]["content"]
		b := out[j]["role"] + out[j]["content"]
		return a < b
	})
	return out
}

// ShouldBypass skips cache for tool-calling and other side-effectful requests.
func ShouldBypass(req openai.ChatCompletionRequest) bool {
	if len(req.Tools) > 0 && !toolChoiceNone(req.ToolChoice) {
		return true
	}
	if containsPIILike(joinMessages(req.Messages, req.System)) {
		return true
	}
	return false
}

func toolChoiceNone(choice any) bool {
	if choice == nil {
		return true
	}
	switch v := choice.(type) {
	case string:
		return strings.EqualFold(strings.TrimSpace(v), "none")
	default:
		return false
	}
}

func joinMessages(messages []openai.ChatMessage, system string) string {
	parts := make([]string, 0, len(messages)+1)
	if strings.TrimSpace(system) != "" {
		parts = append(parts, system)
	}
	for _, msg := range messages {
		parts = append(parts, openai.ComposeMessageContent(msg.Content, msg.ReasoningContent))
	}
	return strings.Join(parts, "\n")
}

func containsPIILike(text string) bool {
	lower := strings.ToLower(text)
	markers := []string{"password", "secret", "api_key", "ssn", "身份证", "银行卡"}
	for _, marker := range markers {
		if strings.Contains(lower, marker) {
			return true
		}
	}
	return false
}

func firstNonZero(values ...int) int {
	for _, v := range values {
		if v > 0 {
			return v
		}
	}
	return 0
}
