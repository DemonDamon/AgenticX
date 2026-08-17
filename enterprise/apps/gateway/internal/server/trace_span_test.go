package server

import (
	"strings"
	"testing"
	"time"

	"github.com/agenticx/enterprise/gateway/internal/openai"
	"github.com/agenticx/enterprise/gateway/internal/routing"
)

// Captures the span that reportUsageDetailed would emit when TraceReporter is wired.
func TestUpstreamErrorSpanMeta(t *testing.T) {
	started := time.Now().Add(-250 * time.Millisecond)
	errMsg := sanitizeTraceError("upstream 500 Authorization: Bearer sk-abcdefghijklmnopqrstuvw")
	span := spanMeta{
		DurationMS:   durationMSSince(started),
		Status:       "error",
		ErrorMessage: errMsg,
		PromptText:   "hello",
	}
	if span.Status != "error" {
		t.Fatalf("status=%s", span.Status)
	}
	if span.ErrorMessage == "" {
		t.Fatal("expected error message")
	}
	if strings.Contains(strings.ToLower(span.ErrorMessage), "authorization") {
		t.Fatalf("Authorization must not appear: %s", span.ErrorMessage)
	}
	if strings.Contains(span.ErrorMessage, "sk-abcdefgh") {
		t.Fatalf("api key leaked: %s", span.ErrorMessage)
	}
	if span.DurationMS <= 0 {
		t.Fatalf("expected positive duration, got %d", span.DurationMS)
	}

	// Compile-time sanity: these types stay compatible with reportUsageDetailed signature.
	_ = func(s *Server) {
		s.reportUsageDetailed(
			requestIdentity{TraceID: "01JZTRACEID000000000000001", TraceStep: 1, TraceStage: "chat.answer"},
			routing.Decision{Model: "m", Provider: "p"},
			openai.Usage{},
			nil,
			span,
		)
	}
}
