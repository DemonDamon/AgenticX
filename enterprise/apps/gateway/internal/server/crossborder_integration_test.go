package server

import (
	"testing"

	"github.com/agenticx/enterprise/gateway/internal/audit"
	"github.com/agenticx/enterprise/gateway/internal/residency"
	"github.com/agenticx/enterprise/gateway/internal/routing"
)

func TestResolveDstRegion_thirdPartyEnv(t *testing.T) {
	t.Setenv("GATEWAY_DEFAULT_UPSTREAM_REGION", "us")
	s := &Server{}
	got := s.resolveDstRegion(routing.Decision{Route: "third-party"})
	if got != "us" {
		t.Fatalf("dst=%q want us", got)
	}
}

func TestResolveDstRegion_localEmpty(t *testing.T) {
	s := &Server{}
	got := s.resolveDstRegion(routing.Decision{Route: "local"})
	if got != "" {
		t.Fatalf("local route should yield empty dst, got %q", got)
	}
}

func TestEvaluateCrossBorder_cnToUsAllow(t *testing.T) {
	s := &Server{compliance: residency.NewComplianceStore(nil)}
	identity := requestIdentity{DataResidency: "cn"}
	t.Setenv("GATEWAY_DEFAULT_UPSTREAM_REGION", "us")
	cb := s.evaluateCrossBorder(nil, identity, routing.Decision{Route: "third-party", Model: "gpt-4"})
	if !cb.CrossBorder {
		t.Fatalf("expected cross border, got %+v", cb)
	}
	if cb.Blocked || cb.PendingApproval {
		t.Fatalf("default allow should not block, got %+v", cb)
	}
}

func TestApplyCrossBorderAuditFields(t *testing.T) {
	cb := residency.Judge("cn", "us", residency.TenantPolicy{CrossBorderAction: residency.ActionBlock})
	ev := audit.Event{}
	applyCrossBorderAuditFields(&ev, cb)
	if !ev.CrossBorder || ev.SrcRegion != "cn" || ev.DstRegion != "us" {
		t.Fatalf("fields not applied: %+v", ev)
	}
}
