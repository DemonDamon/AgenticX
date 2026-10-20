package adaptor

import (
	"net/http"
	"strings"
	"testing"
)

func TestMapUpstream429UsesDedicatedCodeAndSafeMessage(t *testing.T) {
	for _, status := range []int{http.StatusTooManyRequests, 529} {
		apiErr := MapUpstreamError(status, `{"message":"provider details sk-provider-secret"}`, "")
		if apiErr.Code != "42902" || apiErr.HTTPStatus != http.StatusTooManyRequests {
			t.Fatalf("status %d should map to upstream rate limit, got %+v", status, apiErr)
		}
		if apiErr.Message != "模型服务繁忙，请稍后再试" {
			t.Fatalf("status %d message = %q", status, apiErr.Message)
		}
		if strings.Contains(apiErr.Message, "provider details") || strings.Contains(apiErr.Message, "sk-provider-secret") {
			t.Fatalf("upstream response body leaked in rate-limit message: %q", apiErr.Message)
		}
	}
}

func TestMapUpstreamOverloadedBodyUsesRateLimitCode(t *testing.T) {
	apiErr := MapUpstreamError(503, "overloaded_error", "")
	if apiErr.Code != "42902" {
		t.Fatalf("overloaded body should map to 42902, got %+v", apiErr)
	}
}
