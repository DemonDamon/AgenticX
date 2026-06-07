package auth

import (
	"encoding/json"
	"log"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/agenticx/enterprise/gateway/internal/gatewayinternal"
)

// RevocationSnapshot is pulled from admin internal API.
type RevocationSnapshot struct {
	Version       int64    `json:"version"`
	RevokedHashes []string `json:"revokedHashes"`
	UpdatedAt     string   `json:"updatedAt"`
}

// PATRevocationStore tracks revoked token hashes for near-realtime invalidation.
type PATRevocationStore struct {
	remoteURL string
	mu        sync.RWMutex
	version   int64
	hashes    map[string]struct{}
	fetchedAt time.Time
	cacheTTL  time.Duration
}

func NewPATRevocationStore() *PATRevocationStore {
	return &PATRevocationStore{
		remoteURL: strings.TrimSpace(os.Getenv("GATEWAY_REMOTE_PAT_REVOCATION_URL")),
		hashes:    map[string]struct{}{},
		cacheTTL:  5 * time.Second,
	}
}

func (r *PATRevocationStore) IsRevoked(tokenHash string) bool {
	tokenHash = strings.TrimSpace(tokenHash)
	if tokenHash == "" {
		return false
	}
	r.refreshIfNeeded()
	r.mu.RLock()
	defer r.mu.RUnlock()
	_, ok := r.hashes[tokenHash]
	return ok
}

func (r *PATRevocationStore) refreshIfNeeded() {
	u := strings.TrimSpace(r.remoteURL)
	if u == "" || !gatewayinternal.IsHTTPURL(u) {
		return
	}
	r.mu.RLock()
	stale := r.fetchedAt.IsZero() || time.Since(r.fetchedAt) >= r.cacheTTL
	r.mu.RUnlock()
	if !stale {
		return
	}
	raw, code, err := gatewayinternal.HTTPGet(u)
	if err != nil || code < 200 || code >= 300 {
		if err != nil {
			log.Printf("[pat-revocation] remote fetch failed: %v", err)
		}
		return
	}
	var snap RevocationSnapshot
	if err := json.Unmarshal(raw, &snap); err != nil {
		log.Printf("[pat-revocation] parse failed: %v", err)
		return
	}
	next := map[string]struct{}{}
	for _, h := range snap.RevokedHashes {
		h = strings.TrimSpace(h)
		if h != "" {
			next[h] = struct{}{}
		}
	}
	r.mu.Lock()
	r.version = snap.Version
	r.hashes = next
	r.fetchedAt = time.Now()
	r.mu.Unlock()
}

func (r *PATRevocationStore) InvalidateLocal(hash string) {
	hash = strings.TrimSpace(hash)
	if hash == "" {
		return
	}
	r.mu.Lock()
	r.hashes[hash] = struct{}{}
	r.version++
	r.mu.Unlock()
}
