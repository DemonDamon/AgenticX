package quota

import (
	"sync"
	"time"
)

// RateLimiter provides TPM/RPM windows via a pluggable backend and in-process concurrency semaphores.
type RateLimiter struct {
	backend     limiterBackend
	mu          sync.Mutex
	concurrency map[string]int
}

func NewRateLimiter() *RateLimiter {
	return NewRateLimiterWithBackend(newInProcessBackend())
}

func NewRateLimiterWithBackend(backend limiterBackend) *RateLimiter {
	if backend == nil {
		backend = newInProcessBackend()
	}
	return &RateLimiter{
		backend:     backend,
		concurrency: map[string]int{},
	}
}

func (l *RateLimiter) AllowTPM(key string, limit int, tokens int64) (allowed bool, used int64) {
	if l == nil || l.backend == nil {
		return true, 0
	}
	return l.backend.AllowTPM(key, limit, tokens)
}

func (l *RateLimiter) AllowRPM(key string, limit int) (allowed bool, used int) {
	if l == nil || l.backend == nil {
		return true, 0
	}
	return l.backend.AllowRPM(key, limit)
}

func (l *RateLimiter) AcquireConcurrency(key string, limit int) (acquired bool, current int) {
	if limit <= 0 {
		return true, 0
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	cur := l.concurrency[key]
	if cur >= limit {
		return false, cur
	}
	l.concurrency[key] = cur + 1
	return true, cur + 1
}

func (l *RateLimiter) ReleaseConcurrency(key string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	cur := l.concurrency[key]
	if cur <= 1 {
		delete(l.concurrency, key)
		return
	}
	l.concurrency[key] = cur - 1
}

type windowSum struct {
	buckets []bucketSum
	limit   int64
	window  time.Duration
}

type bucketSum struct {
	at     time.Time
	amount int64
}

type windowCount struct {
	times  []time.Time
	limit  int
	window time.Duration
}
