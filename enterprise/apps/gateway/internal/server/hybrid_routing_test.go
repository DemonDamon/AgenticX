package server

import (
	"testing"

	"github.com/agenticx/enterprise/gateway/internal/channel"
)

func TestHybridChannelRoutesDistinctPools(t *testing.T) {
	cloud := channel.Channel{
		ID: "cloud-deepseek", Route: "third-party", ProviderLabel: "deepseek",
		BaseURL: "https://api.deepseek.com/v1",
	}
	local := channel.Channel{
		ID: "private-ollama", Route: "local", ProviderLabel: "edge-agent",
		BaseURL: "http://127.0.0.1:11434/v1",
	}
	dCloud := decisionFromChannel(cloud, "deepseek-chat")
	dLocal := decisionFromChannel(local, "llama3")
	if dCloud.Route != "third-party" {
		t.Fatalf("cloud route = %q", dCloud.Route)
	}
	if dLocal.Route != "local" {
		t.Fatalf("local route = %q", dLocal.Route)
	}
	if dCloud.Endpoint != cloud.BaseURL || dLocal.Endpoint != local.BaseURL {
		t.Fatal("endpoint mismatch")
	}
}
