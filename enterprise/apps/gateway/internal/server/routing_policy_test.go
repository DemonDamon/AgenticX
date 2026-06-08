package server

import (
	"encoding/json"
	"testing"

	"github.com/agenticx/enterprise/gateway/internal/audit"
	"github.com/agenticx/enterprise/gateway/internal/channel"
)

func TestEnrichAuditRoutingPolicy(t *testing.T) {
	ev := audit.Event{ID: "ev1"}
	decision := channel.PickDecision{
		ChannelID: "ch-fast",
		Policy:    channel.LBLatencyAware,
		Reason:    "latency",
	}
	enrichAuditRoutingPolicy(&ev, decision)
	if len(ev.RoutingPolicy) == 0 {
		t.Fatal("expected routing_policy on audit event")
	}
	var got channel.PickDecision
	if err := json.Unmarshal(ev.RoutingPolicy, &got); err != nil {
		t.Fatalf("unmarshal routing_policy: %v", err)
	}
	if got.ChannelID != "ch-fast" || got.Policy != channel.LBLatencyAware || got.Reason != "latency" {
		t.Fatalf("unexpected routing_policy: %+v", got)
	}
}

func TestEnrichAuditRoutingPolicySkipsEmpty(t *testing.T) {
	ev := audit.Event{ID: "ev2"}
	enrichAuditRoutingPolicy(&ev, channel.PickDecision{})
	if len(ev.RoutingPolicy) != 0 {
		t.Fatalf("expected empty routing_policy, got %s", string(ev.RoutingPolicy))
	}
}
