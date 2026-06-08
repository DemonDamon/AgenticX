package quota

import (
	"sync"
	"time"
)

type limiterBackend interface {
	AllowRPM(key string, limit int) (allowed bool, used int)
	AllowTPM(key string, limit int, tokens int64) (allowed bool, used int64)
}

type inProcessBackend struct {
	mu           sync.Mutex
	tokenWindows map[string]*windowSum
	reqWindows   map[string]*windowCount
}

func newInProcessBackend() *inProcessBackend {
	return &inProcessBackend{
		tokenWindows: map[string]*windowSum{},
		reqWindows:   map[string]*windowCount{},
	}
}

func (b *inProcessBackend) AllowTPM(key string, limit int, tokens int64) (allowed bool, used int64) {
	if limit <= 0 {
		return true, 0
	}
	b.mu.Lock()
	defer b.mu.Unlock()
	w := b.tokenWindows[key]
	if w == nil {
		w = &windowSum{limit: int64(limit), window: time.Minute}
		b.tokenWindows[key] = w
	}
	now := time.Now().UTC()
	cutoff := now.Add(-w.window)
	sum := int64(0)
	kept := w.buckets[:0]
	for _, bucket := range w.buckets {
		if bucket.at.After(cutoff) {
			kept = append(kept, bucket)
			sum += bucket.amount
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

func (b *inProcessBackend) AllowRPM(key string, limit int) (allowed bool, used int) {
	if limit <= 0 {
		return true, 0
	}
	b.mu.Lock()
	defer b.mu.Unlock()
	w := b.reqWindows[key]
	if w == nil {
		w = &windowCount{limit: limit, window: time.Minute}
		b.reqWindows[key] = w
	}
	now := time.Now().UTC()
	cutoff := now.Add(-w.window)
	kept := w.times[:0]
	for _, ts := range w.times {
		if ts.After(cutoff) {
			kept = append(kept, ts)
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
