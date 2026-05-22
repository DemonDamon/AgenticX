package observability

import (
	"testing"
	"time"
)

func TestRegistryDisabled(t *testing.T) {
	t.Setenv("GATEWAY_METRICS", "off")
	r := NewRegistryFromEnv()
	if r.Enabled() {
		t.Fatalf("expected metrics disabled")
	}
}

func TestRegistryObserveNoPanic(t *testing.T) {
	t.Setenv("GATEWAY_METRICS", "on")
	r := NewRegistryFromEnv()
	r.ObserveTTFT("gpt-4o", "ch-1", "openai-chat", 120*time.Millisecond)
	r.RecordCacheLookup("L1", "hit")
	r.RecordCacheHit("L1")
}
