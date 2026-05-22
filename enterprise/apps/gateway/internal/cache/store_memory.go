package cache

import (
	"encoding/json"
	"sync"
	"time"
)

type memoryItem struct {
	entry   Entry
	expires time.Time
}

// MemoryStore is an in-process LRU-ish store with TTL eviction.
type MemoryStore struct {
	mu    sync.RWMutex
	items map[string]memoryItem
	max   int
}

func NewMemoryStore(maxEntries int) *MemoryStore {
	if maxEntries <= 0 {
		maxEntries = 4096
	}
	return &MemoryStore{items: make(map[string]memoryItem), max: maxEntries}
}

func (m *MemoryStore) Get(key string) (Entry, bool) {
	m.mu.RLock()
	item, ok := m.items[key]
	m.mu.RUnlock()
	if !ok {
		return Entry{}, false
	}
	if !item.expires.IsZero() && time.Now().After(item.expires) {
		m.mu.Lock()
		delete(m.items, key)
		m.mu.Unlock()
		return Entry{}, false
	}
	return item.entry, true
}

func (m *MemoryStore) Set(key string, entry Entry, ttl time.Duration) {
	if ttl <= 0 {
		ttl = 5 * time.Minute
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	if len(m.items) >= m.max {
		m.evictOneLocked()
	}
	m.items[key] = memoryItem{entry: entry, expires: time.Now().Add(ttl)}
}

func (m *MemoryStore) DeletePrefix(prefix string) int {
	m.mu.Lock()
	defer m.mu.Unlock()
	removed := 0
	for key := range m.items {
		if prefix == "" || len(key) >= len(prefix) && key[:len(prefix)] == prefix {
			delete(m.items, key)
			removed++
		}
	}
	return removed
}

func (m *MemoryStore) evictOneLocked() {
	var oldestKey string
	var oldest time.Time
	for key, item := range m.items {
		if oldestKey == "" || item.expires.Before(oldest) {
			oldestKey = key
			oldest = item.expires
		}
	}
	if oldestKey != "" {
		delete(m.items, oldestKey)
	}
}

// MarshalEntry encodes an entry for redis persistence.
func MarshalEntry(entry Entry) ([]byte, error) {
	return json.Marshal(entry)
}

func UnmarshalEntry(raw []byte) (Entry, error) {
	var entry Entry
	err := json.Unmarshal(raw, &entry)
	return entry, err
}
