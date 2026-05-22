package keypool

import (
	"os"
	"testing"
	"time"
)

func TestCooldownTTLExpires(t *testing.T) {
	pool := NewPool()
	pool.cooldownTTL = 50 * time.Millisecond
	pool.failureThreshold = 1
	os.Setenv("K1", "good")
	defer os.Unsetenv("K1")

	pool.MarkFailure("p1", "K1", "401")
	if got := pool.Resolve("p1", "", []string{"K1"}); got != "" {
		t.Fatalf("expected cooldown skip, got key")
	}
	time.Sleep(60 * time.Millisecond)
	if got := pool.Resolve("p1", "", []string{"K1"}); got != "good" {
		t.Fatalf("expected key after cooldown, got %q", got)
	}
}

func TestResolveRotatesKeys(t *testing.T) {
	pool := NewPool()
	os.Setenv("A", "ka")
	os.Setenv("B", "kb")
	defer os.Unsetenv("A")
	defer os.Unsetenv("B")

	r1 := pool.ResolveWithRef("rot", "", []string{"A", "B"}, nil)
	r2 := pool.ResolveWithRef("rot", "", []string{"A", "B"}, nil)
	if r1.KeyRef == r2.KeyRef {
		t.Fatalf("expected rotation, same ref %s", r1.KeyRef)
	}
}

func TestStatsReportsCooldown(t *testing.T) {
	pool := NewPool()
	pool.failureThreshold = 1
	os.Setenv("S1", "v")
	defer os.Unsetenv("S1")
	pool.MarkFailure("ch", "S1", "429")
	stats := pool.Stats("ch", []string{"S1"})
	if len(stats) != 1 || stats[0].Status != statusCooldown {
		t.Fatalf("unexpected stats: %+v", stats)
	}
}
