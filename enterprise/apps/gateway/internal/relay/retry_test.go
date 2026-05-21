package relay

import (
	"errors"
	"fmt"
	"testing"

	"github.com/agenticx/enterprise/gateway/internal/adaptor"
)

func TestIsRetryableUpstream5xx(t *testing.T) {
	err := &adaptor.UpstreamError{StatusCode: 503, Body: "unavailable"}
	if !IsRetryable(err) {
		t.Fatal("expected 503 retryable")
	}
}

func TestIsRetryable429(t *testing.T) {
	err := &adaptor.UpstreamError{StatusCode: 429, Body: "rate limit"}
	if !IsRetryable(err) {
		t.Fatal("expected 429 retryable")
	}
}

func TestIsRetryable401(t *testing.T) {
	err := &adaptor.UpstreamError{StatusCode: 401, Body: "auth"}
	if IsRetryable(err) {
		t.Fatal("expected 401 not retryable")
	}
}

func TestIsRetryablePolicyLike(t *testing.T) {
	err := fmt.Errorf("policy blocked stream chunk")
	if IsRetryable(err) {
		t.Fatal("policy errors should not retry")
	}
}

func TestIsRetryableConnection(t *testing.T) {
	err := errors.New("upstream request failed: connection refused")
	if !IsRetryable(err) {
		t.Fatal("expected connection error retryable")
	}
}

func TestIsRetryableStreamGuard(t *testing.T) {
	if IsRetryable(fmt.Errorf("stream:buffer_exceeded")) {
		t.Fatal("buffer exceeded should not retry")
	}
	if IsRetryable(fmt.Errorf("stream:idle_timeout")) {
		t.Fatal("idle timeout should not retry")
	}
}
