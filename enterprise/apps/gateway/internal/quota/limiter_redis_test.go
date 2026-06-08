package quota

import (
	"testing"
	"time"

	miniredis "github.com/alicebob/miniredis/v2"
)

func TestRedisLimiterSharedAcrossInstances(t *testing.T) {
	mr, err := miniredis.Run()
	if err != nil {
		t.Fatal(err)
	}
	defer mr.Close()

	backend1, err := newRedisLimiterBackend("redis://" + mr.Addr())
	if err != nil {
		t.Fatal(err)
	}
	backend2, err := newRedisLimiterBackend("redis://" + mr.Addr())
	if err != nil {
		t.Fatal(err)
	}
	lim1 := NewRateLimiterWithBackend(backend1)
	lim2 := NewRateLimiterWithBackend(backend2)

	for i := 0; i < 3; i++ {
		ok, _ := lim1.AllowRPM("shared-key", 3)
		if !ok {
			t.Fatalf("instance1 attempt %d should pass", i+1)
		}
	}
	ok, used := lim2.AllowRPM("shared-key", 3)
	if ok {
		t.Fatalf("instance2 should be blocked at shared limit, used=%d", used)
	}
	if used != 3 {
		t.Fatalf("expected used=3, got %d", used)
	}
}

func TestRedisLimiterWindowExpires(t *testing.T) {
	mr, err := miniredis.Run()
	if err != nil {
		t.Fatal(err)
	}
	defer mr.Close()

	backend, err := newRedisLimiterBackend("redis://" + mr.Addr())
	if err != nil {
		t.Fatal(err)
	}
	lim := NewRateLimiterWithBackend(backend)

	for i := 0; i < 2; i++ {
		ok, _ := lim.AllowRPM("expire-key", 2)
		if !ok {
			t.Fatalf("attempt %d should pass", i+1)
		}
	}
	ok, _ := lim.AllowRPM("expire-key", 2)
	if ok {
		t.Fatal("third request should block")
	}

	mr.FastForward(61 * time.Second)

	ok, _ = lim.AllowRPM("expire-key", 2)
	if !ok {
		t.Fatal("request after window expiry should pass")
	}
}

func TestRedisLimiterInitFallback(t *testing.T) {
	t.Setenv("GATEWAY_REDIS_URL", "redis://127.0.0.1:1")
	t.Setenv("REDIS_URL", "")

	lim := buildSharedRateLimiter()
	if lim == nil {
		t.Fatal("expected limiter")
	}
	ok, _ := lim.AllowRPM("fallback-key", 1)
	if !ok {
		t.Fatal("in-process fallback should allow first request")
	}
	ok, _ = lim.AllowRPM("fallback-key", 1)
	if ok {
		t.Fatal("in-process fallback should enforce limit locally")
	}
}

func TestBuildSharedRateLimiterWithoutRedis(t *testing.T) {
	t.Setenv("GATEWAY_REDIS_URL", "")
	t.Setenv("REDIS_URL", "")

	lim := buildSharedRateLimiter()
	ok, _ := lim.AllowRPM("local-key", 2)
	if !ok {
		t.Fatal("expected first rpm pass")
	}
	ok, _ = lim.AllowRPM("local-key", 2)
	if !ok {
		t.Fatal("expected second rpm pass")
	}
	ok, _ = lim.AllowRPM("local-key", 2)
	if ok {
		t.Fatal("expected third rpm blocked")
	}
}

func TestRedisLimiterTPMShared(t *testing.T) {
	mr, err := miniredis.Run()
	if err != nil {
		t.Fatal(err)
	}
	defer mr.Close()

	backend, err := newRedisLimiterBackend("redis://" + mr.Addr())
	if err != nil {
		t.Fatal(err)
	}
	lim := NewRateLimiterWithBackend(backend)

	ok, _ := lim.AllowTPM("tpm-key", 100, 60)
	if !ok {
		t.Fatal("first tpm should pass")
	}
	ok, used := lim.AllowTPM("tpm-key", 100, 50)
	if ok {
		t.Fatalf("second tpm should block, used=%d", used)
	}
}

func TestRedisLimiterRuntimeFallback(t *testing.T) {
	mr, err := miniredis.Run()
	if err != nil {
		t.Fatal(err)
	}
	backend, err := newRedisLimiterBackend("redis://" + mr.Addr())
	if err != nil {
		t.Fatal(err)
	}
	lim := NewRateLimiterWithBackend(backend)
	mr.Close()

	ok, _ := lim.AllowRPM("runtime-fallback", 5)
	if !ok {
		t.Fatal("runtime redis failure should fallback to in-process and allow")
	}
}
