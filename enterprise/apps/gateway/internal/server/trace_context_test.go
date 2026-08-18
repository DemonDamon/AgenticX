package server

import (
	"net/http/httptest"
	"strings"
	"testing"
)

func TestParseTraceStep(t *testing.T) {
	if parseTraceStep("2") != 2 {
		t.Fatal("expected step 2")
	}
	if parseTraceStep("0") != 0 {
		t.Fatal("expected 0 for invalid step")
	}
	if parseTraceStep("abc") != 0 {
		t.Fatal("expected 0 for non-numeric step")
	}
}

func TestEnrichTraceFromRequest(t *testing.T) {
	req := httptest.NewRequest("POST", "/v1/chat/completions", nil)
	req.Header.Set(headerTraceID, "trace_demo")
	req.Header.Set(headerTraceStep, "3")
	req.Header.Set(headerTraceStage, "dr.lane.expand")
	id := enrichTraceFromRequest(requestIdentity{TenantID: "t1"}, req)
	if id.TraceID != "trace_demo" || id.TurnID != "trace_demo" || id.TraceStep != 3 || id.TraceStage != "dr.lane.expand" {
		t.Fatalf("unexpected trace context: %+v", id)
	}
}

func TestExplicitTurnIDTakesPriorityOverTraceID(t *testing.T) {
	req := httptest.NewRequest("POST", "/v1/chat/completions", nil)
	req.Header.Set(headerTraceID, "trace_demo")
	req.Header.Set(headerTurnID, "client-turn-42")
	id := enrichTraceFromRequest(requestIdentity{TenantID: "t1"}, req)
	if id.TurnID != "client-turn-42" || id.TraceID != "trace_demo" {
		t.Fatalf("unexpected turn/trace context: %+v", id)
	}
}

func TestMissingTurnAndTraceGetsRequestLocalTurnID(t *testing.T) {
	first := enrichTraceFromRequest(requestIdentity{TenantID: "t1"}, httptest.NewRequest("POST", "/v1/chat/completions", nil))
	second := enrichTraceFromRequest(requestIdentity{TenantID: "t1"}, httptest.NewRequest("POST", "/v1/chat/completions", nil))
	if !strings.HasPrefix(first.TurnID, "req-") || len(first.TurnID) > 128 {
		t.Fatalf("invalid generated turn id %q", first.TurnID)
	}
	if first.TurnID == second.TurnID {
		t.Fatalf("request-local fallbacks must not be reused: %q", first.TurnID)
	}
	if first.TraceID != "" {
		t.Fatalf("generated turn id must not fabricate trace identity: %+v", first)
	}
	if got := (&Server{}).quotaContext(first, "model-a").TurnID; got != first.TurnID {
		t.Fatalf("generated turn id did not reach quota context: got=%q want=%q", got, first.TurnID)
	}
}

func TestInvalidCorrelationIDsFallBackSafely(t *testing.T) {
	req := httptest.NewRequest("POST", "/v1/chat/completions", nil)
	req.Header.Set(headerTurnID, strings.Repeat("t", 129))
	req.Header.Set(headerTraceID, "trace/unsafe")
	id := enrichTraceFromRequest(requestIdentity{TenantID: "t1"}, req)
	if !strings.HasPrefix(id.TurnID, "req-") || id.TraceID != "" {
		t.Fatalf("invalid ids must be discarded before fallback: %+v", id)
	}

	req = httptest.NewRequest("POST", "/v1/chat/completions", nil)
	req.Header.Set(headerTurnID, strings.Repeat("t", 129))
	req.Header.Set(headerTraceID, "trace-safe:42")
	id = enrichTraceFromRequest(requestIdentity{TenantID: "t1"}, req)
	if id.TurnID != "trace-safe:42" || id.TraceID != "trace-safe:42" {
		t.Fatalf("valid trace must follow an invalid explicit turn id: %+v", id)
	}
}

func TestSanitizeStage(t *testing.T) {
	if got := sanitizeStage("dr.lane.expand"); got != "dr.lane.expand" {
		t.Fatalf("got %q", got)
	}
	if got := sanitizeStage("DR.Plan"); got != "dr.plan" {
		t.Fatalf("expected lowercased, got %q", got)
	}
	if got := sanitizeStage("a b<script>"); got != "" {
		t.Fatalf("illegal chars should discard, got %q", got)
	}
	long := strings.Repeat("a", 70)
	if got := sanitizeStage(long); len(got) != 64 {
		t.Fatalf("expected truncate to 64, got len=%d", len(got))
	}
}

func TestSanitizeTraceError(t *testing.T) {
	msg := sanitizeTraceError("upstream failed Authorization: Bearer secret-token-value")
	if strings.Contains(strings.ToLower(msg), "secret-token") {
		t.Fatalf("credential leaked: %s", msg)
	}
	if strings.Contains(strings.ToLower(msg), "authorization") {
		t.Fatalf("Authorization must not appear: %s", msg)
	}
	if msg == "" {
		t.Fatal("expected non-empty sanitized error")
	}
	huge := strings.Repeat("e", 800)
	if got := sanitizeTraceError(huge); len([]rune(got)) != 500 {
		t.Fatalf("expected 500 runes, got %d", len([]rune(got)))
	}
}
