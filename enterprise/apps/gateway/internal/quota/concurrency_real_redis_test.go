package quota

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/redis/go-redis/v9"
)

func TestSharedConcurrencyRealRedis(t *testing.T) {
	raw := os.Getenv("GATEWAY_LEASE_TEST_REDIS_URL")
	if raw == "" {
		t.Skip("requires disposable Redis service")
	}
	if os.Getenv("GATEWAY_LEASE_TEST_ALLOW_PAUSE") != "1" {
		t.Fatal("requires explicit disposable-service pause opt-in")
	}
	opts, err := redis.ParseURL(raw)
	if err != nil {
		t.Fatal("invalid fixture Redis URL")
	}
	client := redis.NewClient(opts)
	defer client.Close()
	if err = client.Ping(context.Background()).Err(); err != nil {
		t.Fatal("fixture Redis unreachable")
	}
	store := &redisConcurrencyStore{client: client.WithTimeout(30 * time.Millisecond)}
	key := "lease-real-" + newLedgerID()
	defer client.Del(context.Background(), key)
	cfg := leaseSettings{ttl: time.Second, margin: 100 * time.Millisecond, renew: 100 * time.Millisecond, retry: 20 * time.Millisecond, opTimeout: 30 * time.Millisecond}
	started := time.Now()
	ok, _, err := store.acquire(context.Background(), key, "owner", 1, cfg.ttl)
	if err != nil || !ok {
		t.Fatal(err)
	}
	lease := newRenewableLease(store, key, "owner", cfg, started)
	defer lease.Release()
	// Pause actual command processing beyond one operation timeout but well below
	// the confirmed deadline. A single failed renewal must not terminate work.
	if err = client.Do(context.Background(), "CLIENT", "PAUSE", 250, "ALL").Err(); err != nil {
		t.Fatal(err)
	}
	time.Sleep(500 * time.Millisecond)
	if lease.IsLost() {
		t.Fatal("short real Redis pause killed lease")
	}
	// Persistent unreachability must stop before the last confirmed server expiry.
	bound, cancel := lease.Bind(context.Background())
	defer cancel()
	if err = client.Do(context.Background(), "CLIENT", "PAUSE", 1500, "ALL").Err(); err != nil {
		t.Fatal(err)
	}
	waitLeaseLost(t, lease)
	select {
	case <-bound.Done():
	case <-time.After(time.Second):
		t.Fatal("loss failed to cancel bound context")
	}
	// Let the disposable service resume before cleanup/owner checks.
	time.Sleep(800 * time.Millisecond)
	key2 := key + "-crash"
	defer client.Del(context.Background(), key2)
	if ok, _, err = store.acquire(context.Background(), key2, "crashed", 1, 100*time.Millisecond); err != nil || !ok {
		t.Fatal(err)
	}
	time.Sleep(150 * time.Millisecond)
	if ok, _, err = store.acquire(context.Background(), key2, "successor", 1, time.Second); err != nil || !ok {
		t.Fatal("crashed owner was not reclaimed", err)
	}
	if ok, err = store.renew(context.Background(), key2, "crashed", time.Second); err != nil || ok {
		t.Fatal("old owner revived", err)
	}
	if err = store.release(context.Background(), key2, "crashed"); err != nil {
		t.Fatal(err)
	}
	if ok, _, err = store.acquire(context.Background(), key2, "third", 1, time.Second); err != nil || ok {
		t.Fatal("old release harmed successor", err)
	}
	t.Log("real service: short pause survived; long pause cancelled; crashed and old owners isolated")
}
