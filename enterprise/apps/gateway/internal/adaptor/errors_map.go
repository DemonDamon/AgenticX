package adaptor

import (
	"strings"

	"github.com/agenticx/enterprise/gateway/internal/openai"
)

// MapUpstreamError converts provider-specific errors to OpenAI-compatible APIError.
func MapUpstreamError(status int, body string, inboundProtocol string) openai.APIError {
	bodyLower := strings.ToLower(body)
	switch {
	case status == 529 || strings.Contains(bodyLower, "overloaded"):
		return openai.QuotaExceeded("Upstream overloaded")
	case status == 429:
		return openai.QuotaExceeded(nonEmptyMessage(body, "Rate limit exceeded"))
	case status == 401 || status == 403:
		return openai.Unauthorized(nonEmptyMessage(body, "invalid upstream credentials"))
	case status >= 500:
		return openai.Internal(nonEmptyMessage(body, "upstream server error"))
	default:
		if strings.Contains(bodyLower, "safety") && inboundProtocol == "gemini-generate" {
			return openai.PolicyBlocked("Upstream safety block")
		}
		return openai.BadRequest(nonEmptyMessage(body, "upstream request failed"))
	}
}

func nonEmptyMessage(body, fallback string) string {
	body = strings.TrimSpace(body)
	if body == "" {
		return fallback
	}
	if len(body) > 512 {
		return body[:512]
	}
	return body
}
