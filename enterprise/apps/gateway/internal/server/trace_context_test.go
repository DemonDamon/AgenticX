package server

import (
	"net/http/httptest"
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
	id := enrichTraceFromRequest(requestIdentity{TenantID: "t1"}, req)
	if id.TraceID != "trace_demo" || id.TraceStep != 3 {
		t.Fatalf("unexpected trace context: %+v", id)
	}
}
