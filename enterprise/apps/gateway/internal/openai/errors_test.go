package openai

import "net/http"
import "testing"

func TestQuotaExceededStaysTenantCode(t *testing.T) {
	apiErr := QuotaExceeded("token quota exceeded")
	if apiErr.Code != "42901" || apiErr.HTTPStatus != http.StatusTooManyRequests {
		t.Fatalf("tenant quota must stay 42901, got %+v", apiErr)
	}
}

func TestUpstreamRateLimitedCode(t *testing.T) {
	apiErr := UpstreamRateLimited("模型服务繁忙，请稍后再试")
	if apiErr.Code != "42902" || apiErr.HTTPStatus != http.StatusTooManyRequests {
		t.Fatalf("upstream throttle must be 42902, got %+v", apiErr)
	}
	if apiErr.Message != "模型服务繁忙，请稍后再试" {
		t.Fatalf("unexpected message %q", apiErr.Message)
	}
}
