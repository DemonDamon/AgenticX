package quota

import (
	"sync"
	"time"
)

// RateLimiter provides in-process TPM/RPM sliding windows and concurrency semaphores.
type RateLimiter struct {
	mu           sync.Mutex
	tokenWindows map[string]*windowSum
	reqWindows   map[string]*windowCount
	concurrency  map[string]int
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

func NewRateLimiter() *RateLimiter {
	return &RateLimiter{
		tokenWindows: map[string]*windowSum{},
		reqWindows:   map[string]*windowCount{},
		concurrency:  map[string]int{},
	}
}

func (l *RateLimiter) AllowTPM(key string, limit int, tokens int64) (allowed bool, used int64) {
	if limit <= 0 {
		return true, 0
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	w := l.tokenWindows[key]
	if w == nil {
		w = &windowSum{limit: int64(limit), window: time.Minute}
		l.tokenWindows[key] = w
	}
	now := time.Now().UTC()
	cutoff := now.Add(-w.window)
	sum := int64(0)
	kept := w.buckets[:0]
	for _, b := range w.buckets {
		if b.at.After(cutoff) {
			kept = append(kept, b)
			sum += b.amount
		}
	}
	if sum+tokens > w.limit {
		w.buckets = kept
		return false, sum
	}
	kept = append(kept, bucketSum{at: now, amount: tokens})
	w.buckets = kept
	return true, sum + tokens
}

func (l *RateLimiter) AllowRPM(key string, limit int) (allowed bool, used int) {
	if limit <= 0 {
		return true, 0
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	w := l.reqWindows[key]
	if w == nil {
		w = &windowCount{limit: limit, window: time.Minute}
		l.reqWindows[key] = w
	}
	now := time.Now().UTC()
	cutoff := now.Add(-w.window)
	kept := w.times[:0]
	for _, t := range w.times {
		if t.After(cutoff) {
			kept = append(kept, t)
		}
	}
	if len(kept) >= w.limit {
		w.times = kept
		return false, len(kept)
	}
	kept = append(kept, now)
	w.times = kept
	return true, len(kept)
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
