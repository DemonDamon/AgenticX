package server

import (
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/agenticx/enterprise/gateway/internal/audit"
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
	if id.TraceID != "trace_demo" || id.TraceStep != 3 || id.TraceStage != "dr.lane.expand" {
		t.Fatalf("unexpected trace context: %+v", id)
	}
}

func TestEnrichTraceFromRequestCorrelation(t *testing.T) {
	req := httptest.NewRequest("POST", "/v1/chat/completions", nil)
	req.Header.Set(headerTraceID, "trace_demo")
	req.Header.Set(headerSessionID, "sess-from-header")
	req.Header.Set(headerDeploymentID, "dep-9")
	id := enrichTraceFromRequest(requestIdentity{TenantID: "t1"}, req)
	if id.SessionID != "sess-from-header" || id.DeploymentID != "dep-9" {
		t.Fatalf("unexpected identity: %+v", id)
	}
	id2 := enrichTraceFromRequest(requestIdentity{TenantID: "t1", SessionID: "jwt-sess"}, req)
	if id2.SessionID != "jwt-sess" {
		t.Fatalf("header must not override JWT session, got %q", id2.SessionID)
	}
}

func TestFillAuditCorrelation(t *testing.T) {
	ev := fillAuditCorrelation(audit.Event{ID: "e1"}, requestIdentity{
		TenantID:     "t1",
		SessionID:    "s1",
		TraceID:      "tr1",
		DeploymentID: "dep-1",
	})
	if ev.TenantID != "t1" || ev.SessionID != "s1" || ev.TraceID != "tr1" || ev.DeploymentID != "dep-1" {
		t.Fatalf("expected fill empty fields, got %+v", ev)
	}
	kept := fillAuditCorrelation(audit.Event{
		TenantID:     "keep-t",
		SessionID:    "keep-s",
		TraceID:      "keep-tr",
		DeploymentID: "keep-d",
	}, requestIdentity{
		TenantID:     "t1",
		SessionID:    "s1",
		TraceID:      "tr1",
		DeploymentID: "dep-1",
	})
	if kept.SessionID != "keep-s" || kept.DeploymentID != "keep-d" || kept.TraceID != "keep-tr" || kept.TenantID != "keep-t" {
		t.Fatalf("must not overwrite existing fields, got %+v", kept)
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
