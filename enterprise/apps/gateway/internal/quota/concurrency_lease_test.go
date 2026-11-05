package quota

import (
	"context"
	"errors"
	"github.com/alicebob/miniredis/v2"
	"github.com/redis/go-redis/v9"
	"io"
	"net"
	"sync/atomic"
	"testing"
	"time"
)

type controlledLeaseStore struct {
	renewFunc func(context.Context) (bool, error)
	releases  atomic.Int32
}

func (*controlledLeaseStore) acquire(context.Context, string, string, int, time.Duration) (bool, int, error) {
	return true, 1, nil
}
func (s *controlledLeaseStore) renew(ctx context.Context, _ string, _ string, _ time.Duration) (bool, error) {
	return s.renewFunc(ctx)
}
func (s *controlledLeaseStore) release(context.Context, string, string) error {
	s.releases.Add(1)
	return nil
}
func testLeaseSettings() leaseSettings {
	return leaseSettings{ttl: 400 * time.Millisecond, margin: 50 * time.Millisecond, renew: 50 * time.Millisecond, retry: 10 * time.Millisecond, opTimeout: 25 * time.Millisecond}
}
func waitLeaseLost(t *testing.T, l ConcurrencyLease) {
	t.Helper()
	select {
	case <-l.Lost():
	case <-time.After(2 * time.Second):
		t.Fatal("lease did not expire")
	}
}

func TestConcurrencyLeaseTemporaryErrorsRecoverWithinConfirmedDeadline(t *testing.T) {
	var calls atomic.Int32
	store := &controlledLeaseStore{renewFunc: func(context.Context) (bool, error) {
		if calls.Add(1) <= 3 {
			return false, errors.New("synthetic temporary failure")
		}
		return true, nil
	}}
	l := newRenewableLease(store, "key", "owner", testLeaseSettings(), time.Now())
	defer l.Release()
	time.Sleep(500 * time.Millisecond)
	if l.IsLost() {
		t.Fatal("temporary failures killed a still-confirmed lease")
	}
	if calls.Load() < 4 {
		t.Fatal("renewal did not retry")
	}
}
func TestConcurrencyLeasePersistentFailureExpiresConservatively(t *testing.T) {
	store := &controlledLeaseStore{renewFunc: func(context.Context) (bool, error) { return false, errors.New("unavailable") }}
	started := time.Now()
	l := newRenewableLease(store, "key", "owner", testLeaseSettings(), started)
	defer l.Release()
	ctx, cancel := l.Bind(context.Background())
	defer cancel()
	waitLeaseLost(t, l)
	select {
	case <-ctx.Done():
	case <-time.After(time.Second):
		t.Fatal("bound context not cancelled")
	}
	if !errors.Is(context.Cause(ctx), ErrConcurrencyLeaseLost) {
		t.Fatal(context.Cause(ctx))
	}
	if time.Since(started) > 650*time.Millisecond {
		t.Fatal("loss exceeded conservative deadline")
	}
}
func TestConcurrencyLeaseExplicitMissingLosesImmediately(t *testing.T) {
	store := &controlledLeaseStore{renewFunc: func(context.Context) (bool, error) { return false, nil }}
	started := time.Now()
	l := newRenewableLease(store, "key", "owner", testLeaseSettings(), started)
	defer l.Release()
	waitLeaseLost(t, l)
	if time.Since(started) > 250*time.Millisecond {
		t.Fatal("explicit missing owner waited for expiry")
	}
}
func TestConcurrencyLeaseWatchdogIndependentOfStuckRenewalAndLateSuccess(t *testing.T) {
	entered := make(chan struct{})
	unblock := make(chan struct{})
	store := &controlledLeaseStore{renewFunc: func(context.Context) (bool, error) { close(entered); <-unblock; return true, nil }}
	l := newRenewableLease(store, "key", "owner", testLeaseSettings(), time.Now())
	defer l.Release()
	<-entered
	waitLeaseLost(t, l)
	close(unblock)
	time.Sleep(20 * time.Millisecond)
	if !l.IsLost() {
		t.Fatal("late success revived expired lease")
	}
}
func TestConcurrencyLeaseSynchronousDeadlineCheck(t *testing.T) {
	worker, cancel := context.WithCancel(context.Background())
	defer cancel()
	l := &renewableLease{deadline: time.Now().Add(-time.Second), lost: make(chan struct{}), worker: worker, cancel: cancel}
	if !l.IsLost() {
		t.Fatal("expiry depended on watchdog scheduling")
	}
	ctx, stop := l.Bind(context.Background())
	defer stop()
	if !errors.Is(context.Cause(ctx), ErrConcurrencyLeaseLost) {
		t.Fatal("bind missed synchronous expiry")
	}
}
func TestConcurrencyLeaseReleaseStopsRetryAndIsIdempotent(t *testing.T) {
	var calls atomic.Int32
	store := &controlledLeaseStore{renewFunc: func(context.Context) (bool, error) { calls.Add(1); return false, errors.New("temporary") }}
	l := newRenewableLease(store, "key", "owner", testLeaseSettings(), time.Now())
	l.Release()
	l.Release()
	time.Sleep(80 * time.Millisecond)
	if calls.Load() != 0 || store.releases.Load() != 1 {
		t.Fatal("released lease kept workers running")
	}
}
func TestConcurrencySharedAcrossIndependentLimitersAndOwnerIsolation(t *testing.T) {
	server := miniredis.RunT(t)
	first := NewSharedRateLimiter("redis://" + server.Addr())
	second := NewSharedRateLimiter("redis://" + server.Addr())
	var held []ConcurrencyLease
	for i := 0; i < 12; i++ {
		lim := first
		if i%2 == 1 {
			lim = second
		}
		lease, _, err := lim.AcquireConcurrencyLease(context.Background(), "synthetic-shared", 3)
		if err != nil {
			t.Fatal(err)
		}
		if lease != nil {
			held = append(held, lease)
		}
	}
	if len(held) != 3 {
		t.Fatalf("admitted %d want3", len(held))
	}
	for _, l := range held {
		l.Release()
	}
	// Expiry removes the crashed owner; its later renew/release cannot harm a successor.
	store := first.concurrencyStore
	if ok, _, e := store.acquire(context.Background(), "owners", "old", 1, 100*time.Millisecond); e != nil || !ok {
		t.Fatal(e)
	}
	server.FastForward(time.Second)
	if ok, _, e := store.acquire(context.Background(), "owners", "new", 1, time.Second); e != nil || !ok {
		t.Fatal(e)
	}
	if ok, e := store.renew(context.Background(), "owners", "old", time.Second); e != nil || ok {
		t.Fatal("expired owner renewed", e)
	}
	if e := store.release(context.Background(), "owners", "old"); e != nil {
		t.Fatal(e)
	}
	if ok, _, e := store.acquire(context.Background(), "owners", "third", 1, time.Second); e != nil || ok {
		t.Fatal("old release removed new owner", e)
	}
}
func TestConcurrencyConfiguredUnavailableFailsClosed(t *testing.T) {
	limiter := NewSharedRateLimiter("invalid://synthetic")
	lease, _, err := limiter.AcquireConcurrencyLease(context.Background(), "key", 1)
	if lease != nil || !errors.Is(err, ErrConcurrencyUnavailable) {
		t.Fatal("configured outage used local concurrency", err)
	}
}

func TestConcurrencyLeaseWatchdogDoesNotWaitForUnresponsiveSocket(t *testing.T) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()
	go func() {
		for {
			conn, e := listener.Accept()
			if e != nil {
				return
			}
			go func() { defer conn.Close(); _, _ = io.Copy(io.Discard, conn) }()
		}
	}()
	// Deliberately omit production socket bounds to prove the independent watchdog
	// does not depend on a cooperating transport or context deadline.
	client := redis.NewClient(&redis.Options{Addr: listener.Addr().String(), ReadTimeout: time.Minute, WriteTimeout: time.Minute, MaxRetries: -1})
	store := &redisConcurrencyStore{client: client}
	l := newRenewableLease(store, "stuck-socket", "owner", testLeaseSettings(), time.Now())
	defer func() { _ = client.Close(); l.Release() }()
	waitLeaseLost(t, l)
	if !l.IsLost() {
		t.Fatal("unresponsive socket delayed expiry")
	}
}
func TestConcurrencyConfiguredOutageRecoversWithoutLocalAdmission(t *testing.T) {
	server := miniredis.RunT(t)
	address := server.Addr()
	server.Close()
	limiter := NewSharedRateLimiter("redis://" + address)
	defer limiter.Close()
	if l, _, err := limiter.AcquireConcurrencyLease(context.Background(), "recovery", 1); l != nil || !errors.Is(err, ErrConcurrencyUnavailable) {
		t.Fatal("initial outage admitted locally", err)
	}
	server.Restart()
	l, _, err := limiter.AcquireConcurrencyLease(context.Background(), "recovery", 1)
	if err != nil || l == nil {
		t.Fatal("shared backend did not recover", err)
	}
	l.Release()
}

func TestConcurrencyLeaseConservativeAcquireStartAndReleasedBind(t *testing.T) {
	store := &controlledLeaseStore{renewFunc: func(context.Context) (bool, error) { return true, nil }}
	cfg := testLeaseSettings()
	expired := newRenewableLease(store, "key", "owner", cfg, time.Now().Add(-cfg.ttl))
	if !expired.IsLost() {
		t.Fatal("late acquire response extended validity from response time")
	}
	expired.Release()
	live := newRenewableLease(store, "key", "owner2", cfg, time.Now())
	live.Release()
	ctx, cancel := live.Bind(context.Background())
	defer cancel()
	if !errors.Is(context.Cause(ctx), ErrConcurrencyLeaseLost) {
		t.Fatal("released lease bound a live request")
	}
}

func TestConcurrencyLeaseOptionsRejectUnsafeTiming(t *testing.T) {
	for _, options := range []ConcurrencyLeaseOptions{{}, {TTL: time.Second, SafetyMargin: 10 * time.Millisecond, RenewInterval: 100 * time.Millisecond, RetryInterval: 10 * time.Millisecond, OperationTimeout: 50 * time.Millisecond}, {TTL: time.Second, SafetyMargin: 200 * time.Millisecond, RenewInterval: 900 * time.Millisecond, RetryInterval: 10 * time.Millisecond, OperationTimeout: 50 * time.Millisecond}} {
		if limiter, err := NewSharedRateLimiterWithLeaseOptions("", options); err == nil || limiter != nil {
			t.Fatal("unsafe timings accepted")
		}
	}
}
