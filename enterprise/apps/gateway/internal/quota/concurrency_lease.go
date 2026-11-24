package quota

import (
	"context"
	"errors"
	"sync"
	"time"
)

var ErrConcurrencyLeaseLost = errors.New("quota:concurrency_lease_lost")
var ErrConcurrencyUnavailable = errors.New("quota:concurrency_storage_unavailable")

type ConcurrencyLease interface {
	Release()
	Bind(context.Context) (context.Context, context.CancelFunc)
	Lost() <-chan struct{}
	IsLost() bool
}
type concurrencyStore interface {
	acquire(context.Context, string, string, int, time.Duration) (bool, int, error)
	renew(context.Context, string, string, time.Duration) (bool, error)
	release(context.Context, string, string) error
}
type leaseSettings struct{ ttl, margin, renew, retry, opTimeout time.Duration }

func defaultLeaseSettings() leaseSettings {
	return leaseSettings{45 * time.Second, time.Second, 10 * time.Second, time.Second, defaultRedisOpTimeout}
}

type renewableLease struct {
	store              concurrencyStore
	key, owner         string
	cfg                leaseSettings
	mu                 sync.Mutex
	deadline           time.Time
	lostFlag, released bool
	lost               chan struct{}
	changed            chan struct{}
	worker             context.Context
	cancel             context.CancelFunc
}

func newRenewableLease(store concurrencyStore, key, owner string, cfg leaseSettings, started time.Time) *renewableLease {
	worker, cancel := context.WithCancel(context.Background())
	l := &renewableLease{store: store, key: key, owner: owner, cfg: cfg, deadline: started.Add(cfg.ttl - cfg.margin), lost: make(chan struct{}), changed: make(chan struct{}, 1), worker: worker, cancel: cancel}
	go l.watchdog()
	go l.renewLoop()
	return l
}
func deadlinePassed(now, deadline time.Time) bool {
	return !now.Before(deadline) || !now.Round(0).Before(deadline.Round(0))
}
func (l *renewableLease) markLostLocked() {
	if !l.lostFlag {
		l.lostFlag = true
		close(l.lost)
		l.cancel()
	}
}
func (l *renewableLease) IsLost() bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	if !l.released && deadlinePassed(time.Now(), l.deadline) {
		l.markLostLocked()
	}
	return l.lostFlag || l.released
}
func (l *renewableLease) Lost() <-chan struct{} { return l.lost }
func (l *renewableLease) Bind(ctx context.Context) (context.Context, context.CancelFunc) {
	bound, cancel := context.WithCancelCause(ctx)
	if l.IsLost() {
		cancel(ErrConcurrencyLeaseLost)
	} else {
		go func() {
			select {
			case <-l.lost:
				cancel(ErrConcurrencyLeaseLost)
			case <-bound.Done():
			}
		}()
	}
	return bound, func() { cancel(context.Canceled) }
}
func (l *renewableLease) Release() {
	l.mu.Lock()
	if l.released {
		l.mu.Unlock()
		return
	}
	l.released = true
	l.cancel()
	l.mu.Unlock()
	ctx, cancel := context.WithTimeout(context.Background(), l.cfg.opTimeout)
	defer cancel()
	_ = l.store.release(ctx, l.key, l.owner)
}
func (l *renewableLease) watchdog() {
	for {
		l.mu.Lock()
		wait := time.Until(l.deadline)
		stopped := l.released || l.lostFlag
		l.mu.Unlock()
		if stopped {
			return
		}
		timer := time.NewTimer(max(wait, time.Nanosecond))
		select {
		case <-timer.C:
			if l.IsLost() {
				return
			}
		case <-l.changed:
		case <-l.worker.Done():
			timer.Stop()
			return
		}
		timer.Stop()
	}
}
func (l *renewableLease) renewLoop() {
	delay := l.cfg.renew
	for {
		timer := time.NewTimer(delay)
		select {
		case <-timer.C:
		case <-l.worker.Done():
			timer.Stop()
			return
		}
		if l.IsLost() {
			return
		}
		started := time.Now()
		ctx, cancel := context.WithTimeout(l.worker, l.cfg.opTimeout)
		ok, err := l.store.renew(ctx, l.key, l.owner, l.cfg.ttl)
		cancel()
		l.mu.Lock()
		if l.released || l.lostFlag {
			l.mu.Unlock()
			return
		}
		if deadlinePassed(time.Now(), l.deadline) {
			l.markLostLocked()
			l.mu.Unlock()
			return
		}
		if err == nil && !ok {
			l.markLostLocked()
			l.mu.Unlock()
			return
		}
		if err == nil {
			next := started.Add(l.cfg.ttl - l.cfg.margin)
			if deadlinePassed(time.Now(), next) {
				l.markLostLocked()
				l.mu.Unlock()
				return
			}
			if next.After(l.deadline) {
				l.deadline = next
				select {
				case l.changed <- struct{}{}:
				default:
				}
			}
			delay = l.cfg.renew
		} else {
			delay = l.cfg.retry
		}
		l.mu.Unlock()
	}
}

type localConcurrencyStore struct {
	mu     sync.Mutex
	owners map[string]map[string]bool
}

func (s *localConcurrencyStore) acquire(_ context.Context, key, owner string, limit int, _ time.Duration) (bool, int, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.owners == nil {
		s.owners = map[string]map[string]bool{}
	}
	if s.owners[key] == nil {
		s.owners[key] = map[string]bool{}
	}
	owners := s.owners[key]
	if owners[owner] {
		return true, len(owners), nil
	}
	if len(owners) >= limit {
		return false, len(owners), nil
	}
	owners[owner] = true
	return true, len(owners), nil
}
func (s *localConcurrencyStore) renew(_ context.Context, key, owner string, _ time.Duration) (bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.owners[key][owner], nil
}
func (s *localConcurrencyStore) release(_ context.Context, key, owner string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.owners[key], owner)
	if len(s.owners[key]) == 0 {
		delete(s.owners, key)
	}
	return nil
}

// ConcurrencyLeaseOptions is an explicit embedding configuration. The default
// factory keeps conservative production timings; validation preserves room for
// renewal and bounded I/O before the last-confirmed deadline.
type ConcurrencyLeaseOptions struct{ TTL, SafetyMargin, RenewInterval, RetryInterval, OperationTimeout time.Duration }

func NewSharedRateLimiterWithLeaseOptions(redisURL string, options ConcurrencyLeaseOptions) (*RateLimiter, error) {
	cfg := leaseSettings{ttl: options.TTL, margin: options.SafetyMargin, renew: options.RenewInterval, retry: options.RetryInterval, opTimeout: options.OperationTimeout}
	if cfg.ttl <= 0 || cfg.margin < cfg.opTimeout || cfg.opTimeout <= 0 || cfg.renew < cfg.opTimeout || cfg.retry <= 0 || cfg.retry > cfg.renew || cfg.renew+cfg.margin >= cfg.ttl {
		return nil, errors.New("invalid concurrency lease timings")
	}
	limiter := NewSharedRateLimiter(redisURL)
	limiter.leaseConfig = cfg
	if store, ok := limiter.concurrencyStore.(*redisConcurrencyStore); ok {
		store.client = store.client.WithTimeout(cfg.opTimeout)
	}
	return limiter, nil
}
