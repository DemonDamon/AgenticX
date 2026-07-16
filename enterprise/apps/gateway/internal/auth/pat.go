package auth

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"strings"
	"sync"
	"time"

	"github.com/agenticx/enterprise/gateway/internal/database"
)

// PATIdentity is the resolved identity from a personal access token.
type PATIdentity struct {
	APITokenID int64
	TenantID   string
	UserID     string
	DeptID     string
	Scopes     []string
	UserEmail  string
}

type patCacheEntry struct {
	identity PATIdentity
	expires  time.Time
	revoked  bool
}

// PATVerifier validates agx-pat-* tokens against api_tokens table.
type PATVerifier struct {
	database        *database.Handle
	mu              sync.RWMutex
	cache           map[string]patCacheEntry
	ttl             time.Duration
	touchMu         sync.Mutex
	touchPending    map[int64]struct{}
	touchStarted    bool
	revocationStore *PATRevocationStore
}

func NewPATVerifier(handle *database.Handle) *PATVerifier {
	v := &PATVerifier{
		database:        handle,
		cache:           map[string]patCacheEntry{},
		ttl:             patCacheTTLFromEnv(),
		touchPending:    map[int64]struct{}{},
		revocationStore: NewPATRevocationStore(),
	}
	if handle != nil {
		v.startTouchFlusher()
	}
	return v
}

// NoteUsed queues api_token last_used_at updates (flushed every 60s).
func (v *PATVerifier) NoteUsed(id int64) {
	if v == nil || id <= 0 || v.database == nil {
		return
	}
	v.touchMu.Lock()
	v.touchPending[id] = struct{}{}
	v.touchMu.Unlock()
}

func (v *PATVerifier) startTouchFlusher() {
	v.touchMu.Lock()
	if v.touchStarted {
		v.touchMu.Unlock()
		return
	}
	v.touchStarted = true
	v.touchMu.Unlock()
	go func() {
		ticker := time.NewTicker(60 * time.Second)
		defer ticker.Stop()
		for range ticker.C {
			v.flushTouchPending()
		}
	}()
}

func (v *PATVerifier) flushTouchPending() {
	if v == nil || v.database == nil {
		return
	}
	v.touchMu.Lock()
	pending := make([]int64, 0, len(v.touchPending))
	for id := range v.touchPending {
		pending = append(pending, id)
	}
	v.touchPending = map[int64]struct{}{}
	v.touchMu.Unlock()
	if len(pending) == 0 {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	for _, id := range pending {
		_, _ = v.database.ExecContext(ctx, `UPDATE api_tokens SET last_used_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, id)
	}
}

func (v *PATVerifier) Verify(ctx context.Context, token string) (PATIdentity, error) {
	token = strings.TrimSpace(token)
	if !strings.HasPrefix(token, "agx-pat-") {
		return PATIdentity{}, errors.New("auth:pat:invalid_format")
	}
	hash := hashPAT(token)
	if v.revocationStore != nil && v.revocationStore.IsRevoked(hash) {
		return PATIdentity{}, errors.New("auth:pat_revoked")
	}
	if cached, ok := v.cached(hash); ok {
		if cached.revoked {
			return PATIdentity{}, errors.New("auth:pat_revoked")
		}
		return cached.identity, nil
	}
	if v.database == nil {
		return PATIdentity{}, errors.New("auth:pat:database_unavailable")
	}
	var id int64
	var tenantID, userID, deptID, status string
	var scopes []byte
	var expireAt *time.Time
	row, err := v.database.QueryRowContext(ctx, `
SELECT id, tenant_id, user_id, COALESCE(dept_id, ''), status, scopes, expire_at
FROM api_tokens WHERE token_hash = ? LIMIT 1`, hash)
	if err != nil {
		return PATIdentity{}, errors.New("auth:pat:invalid")
	}
	err = row.Scan(&id, &tenantID, &userID, &deptID, &status, &scopes, &expireAt)
	if err != nil {
		return PATIdentity{}, errors.New("auth:pat:invalid")
	}
	if status == "revoked" {
		v.storeCache(hash, patCacheEntry{revoked: true, expires: time.Now().Add(v.ttl)})
		return PATIdentity{}, errors.New("auth:pat_revoked")
	}
	if expireAt != nil && time.Now().UTC().After(*expireAt) {
		return PATIdentity{}, errors.New("auth:pat:expired")
	}
	parsedScopes := parseScopesJSON(scopes)
	identity := PATIdentity{
		APITokenID: id,
		TenantID:   strings.TrimSpace(tenantID),
		UserID:     strings.TrimSpace(userID),
		DeptID:     strings.TrimSpace(deptID),
		Scopes:     parsedScopes,
	}
	v.storeCache(hash, patCacheEntry{identity: identity, expires: time.Now().Add(v.ttl)})
	return identity, nil
}

func (v *PATVerifier) Invalidate(token string) {
	hash := hashPAT(strings.TrimSpace(token))
	v.mu.Lock()
	delete(v.cache, hash)
	v.mu.Unlock()
	if v.revocationStore != nil {
		v.revocationStore.InvalidateLocal(hash)
	}
}

func (v *PATVerifier) RevocationStore() *PATRevocationStore {
	if v == nil {
		return nil
	}
	return v.revocationStore
}

func (v *PATVerifier) cached(hash string) (patCacheEntry, bool) {
	v.mu.RLock()
	entry, ok := v.cache[hash]
	v.mu.RUnlock()
	if !ok {
		return patCacheEntry{}, false
	}
	if time.Now().After(entry.expires) {
		v.mu.Lock()
		delete(v.cache, hash)
		v.mu.Unlock()
		return patCacheEntry{}, false
	}
	return entry, true
}

func (v *PATVerifier) storeCache(hash string, entry patCacheEntry) {
	v.mu.Lock()
	v.cache[hash] = entry
	v.mu.Unlock()
}

func hashPAT(plain string) string {
	sum := sha256.Sum256([]byte(plain))
	return hex.EncodeToString(sum[:])
}

func parseScopesJSON(raw []byte) []string {
	if len(raw) == 0 {
		return []string{"workspace:chat"}
	}
	var arr []string
	// minimal JSON array parse
	s := strings.TrimSpace(string(raw))
	if !strings.HasPrefix(s, "[") {
		return []string{"workspace:chat"}
	}
	s = strings.Trim(s, "[]")
	if s == "" {
		return []string{"workspace:chat"}
	}
	for _, part := range strings.Split(s, ",") {
		part = strings.Trim(strings.TrimSpace(part), `"`)
		if part != "" {
			arr = append(arr, part)
		}
	}
	if len(arr) == 0 {
		return []string{"workspace:chat"}
	}
	return arr
}
