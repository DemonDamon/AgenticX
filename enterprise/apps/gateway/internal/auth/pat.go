package auth

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
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
	lookup          func(ctx context.Context, tokenHash string) (patTokenRow, error)
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
	row, err := v.lookupToken(ctx, hash)
	if err != nil {
		return PATIdentity{}, err
	}
	if row.Status == "revoked" {
		v.storeCache(hash, patCacheEntry{revoked: true, expires: time.Now().Add(v.ttl)})
		return PATIdentity{}, errors.New("auth:pat_revoked")
	}
	if row.ExpireAt != nil && time.Now().UTC().After(*row.ExpireAt) {
		return PATIdentity{}, errors.New("auth:pat:expired")
	}
	userStatus := strings.TrimSpace(strings.ToLower(row.UserStatus))
	if row.UserEmail == "" || userStatus == "" || userStatus != "active" {
		// Stable internal code; do not expose DB join details to clients.
		return PATIdentity{}, errors.New("auth:pat:user_inactive")
	}
	parsedScopes := parseScopesJSON(row.Scopes)
	identity := PATIdentity{
		APITokenID: row.ID,
		TenantID:   strings.TrimSpace(row.TenantID),
		UserID:     strings.TrimSpace(row.UserID),
		DeptID:     strings.TrimSpace(row.DeptID),
		Scopes:     parsedScopes,
		UserEmail:  strings.TrimSpace(row.UserEmail),
	}
	v.storeCache(hash, patCacheEntry{identity: identity, expires: time.Now().Add(v.ttl)})
	return identity, nil
}

type patTokenRow struct {
	ID         int64
	TenantID   string
	UserID     string
	DeptID     string
	Status     string
	Scopes     []byte
	ExpireAt   *time.Time
	UserEmail  string
	UserStatus string
}

// lookup is an optional test seam; production uses SQL via database.Handle.
func (v *PATVerifier) withLookup(fn func(ctx context.Context, tokenHash string) (patTokenRow, error)) *PATVerifier {
	v.lookup = fn
	return v
}

// SetPATLookupForTest installs a fixed identity for one plaintext token (tests only).
func SetPATLookupForTest(v *PATVerifier, plainToken string, identity PATIdentity) {
	if v == nil {
		return
	}
	hash := hashPAT(strings.TrimSpace(plainToken))
	scopesJSON, _ := json.Marshal(identity.Scopes)
	v.lookup = func(ctx context.Context, tokenHash string) (patTokenRow, error) {
		if tokenHash != hash {
			return patTokenRow{}, errors.New("auth:pat:invalid")
		}
		return patTokenRow{
			ID:         identity.APITokenID,
			TenantID:   identity.TenantID,
			UserID:     identity.UserID,
			DeptID:     identity.DeptID,
			Status:     "active",
			Scopes:     scopesJSON,
			UserEmail:  identity.UserEmail,
			UserStatus: "active",
		}, nil
	}
}

func (v *PATVerifier) lookupToken(ctx context.Context, hash string) (patTokenRow, error) {
	if v.lookup != nil {
		return v.lookup(ctx, hash)
	}
	if v.database == nil {
		return patTokenRow{}, errors.New("auth:pat:database_unavailable")
	}
	var row patTokenRow
	sqlRow, err := v.database.QueryRowContext(ctx, `
SELECT
  t.id,
  t.tenant_id,
  t.user_id,
  COALESCE(t.dept_id, ''),
  t.status,
  t.scopes,
  t.expire_at,
  COALESCE(u.email, ''),
  COALESCE(u.status, '')
FROM api_tokens t
LEFT JOIN users u
  ON u.id = t.user_id
 AND u.tenant_id = t.tenant_id
 AND u.is_deleted = FALSE
 AND u.deleted_at IS NULL
WHERE t.token_hash = ?
LIMIT 1`, hash)
	if err != nil {
		return patTokenRow{}, errors.New("auth:pat:invalid")
	}
	err = sqlRow.Scan(
		&row.ID,
		&row.TenantID,
		&row.UserID,
		&row.DeptID,
		&row.Status,
		&row.Scopes,
		&row.ExpireAt,
		&row.UserEmail,
		&row.UserStatus,
	)
	if err != nil {
		return patTokenRow{}, errors.New("auth:pat:invalid")
	}
	return row, nil
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
