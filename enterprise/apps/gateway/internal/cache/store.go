package cache

import "time"

// Store persists cache entries keyed by canonical hash.
type Store interface {
	Get(key string) (Entry, bool)
	Set(key string, entry Entry, ttl time.Duration)
	DeletePrefix(prefix string) int
}
