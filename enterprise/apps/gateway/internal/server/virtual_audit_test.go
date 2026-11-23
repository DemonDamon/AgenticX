package server

import (
	"encoding/json"
	"testing"

	"github.com/agenticx/enterprise/gateway/internal/audit"
	"github.com/agenticx/enterprise/gateway/internal/channel"
)

func TestAnnotateVirtualModelAuditRecordsRequestedAndActual(t *testing.T) {
	ev := audit.Event{Model: "virt"}
	enrichAuditRoutingPolicy(&ev, channel.PickDecision{
		ChannelID: "ch-1",
		Policy:    channel.LBWeight,
		Reason:    "weight",
		Priority:  0,
	})
	annotateVirtualModelAudit(&ev, "virt", "real-a")
	if ev.Model != "real-a" {
		t.Fatalf("model = %q, want real-a", ev.Model)
	}
	var got map[string]any
	if err := json.Unmarshal(ev.RoutingPolicy, &got); err != nil {
		t.Fatal(err)
	}
	if got["requested_model"] != "virt" {
		t.Fatalf("routing_policy = %#v", got)
	}
	if got["channel_id"] != "ch-1" {
		t.Fatalf("routing_policy dropped channel decision: %#v", got)
	}
}

func TestAnnotateVirtualModelAuditLeavesOrdinaryRequests(t *testing.T) {
	ev := audit.Event{Model: "real-a"}
	enrichAuditRoutingPolicy(&ev, channel.PickDecision{
		ChannelID: "ch-1",
		Policy:    channel.LBWeight,
		Reason:    "weight",
		Priority:  0,
	})
	before := append([]byte(nil), ev.RoutingPolicy...)
	annotateVirtualModelAudit(&ev, "", "")
	if ev.Model != "real-a" {
		t.Fatalf("model changed to %q", ev.Model)
	}
	if string(ev.RoutingPolicy) != string(before) {
		t.Fatalf("routing_policy changed: %s", ev.RoutingPolicy)
	}
}
