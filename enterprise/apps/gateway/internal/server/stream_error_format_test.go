package server

import (
	"errors"
	"strings"
	"testing"
)

func TestStreamErrorCodeDoesNotMapIdleTimeoutToPolicy(t *testing.T) {
	if code := streamErrorCode(errors.New("stream:idle_timeout")); code != "" {
		t.Fatalf("idle_timeout must not map to policy code, got %q", code)
	}
	if code := streamErrorCode(errors.New("stream:buffer_exceeded")); code != "90002" {
		t.Fatalf("buffer_exceeded should keep policy code 90002, got %q", code)
	}
}

func TestFormatStreamErrorIdleTimeoutMessage(t *testing.T) {
	msg := formatStreamError(errors.New("stream:idle_timeout"))
	if !strings.Contains(msg, "流式空闲超时") {
		t.Fatalf("expected human idle timeout message, got %q", msg)
	}
	if strings.Contains(msg, "合规") {
		t.Fatalf("idle timeout must not mention compliance, got %q", msg)
	}
}
