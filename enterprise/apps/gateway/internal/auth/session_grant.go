package auth

import (
	"context"
	"encoding/json"
	"log"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/agenticx/enterprise/gateway/internal/database"
	"github.com/agenticx/enterprise/gateway/internal/gatewayinternal"
)

// SessionGrantStore resolves temporary session scopes (TTL-bound).
type SessionGrantStore struct {
	database  *database.Handle
	remoteURL string
	mu        sync.RWMutex
	snapshot  map[string][]string // sessionId -> scopes
	fetchedAt time.Time
	cacheTTL  time.Duration
}

func NewSessionGrantStore(handle *database.Handle) *SessionGrantStore {
	return &SessionGrantStore{
		database:  handle,
		remoteURL: strings.TrimSpace(os.Getenv("GATEWAY_REMOTE_SESSION_GRANTS_URL")),
		snapshot:  map[string][]string{},
		cacheTTL:  10 * time.Second,
	}
}

func (s *SessionGrantStore) ScopesFor(ctx context.Context, tenantID, sessionID string) []string {
	sessionID = strings.TrimSpace(sessionID)
	if sessionID == "" {
		return nil
	}
	if s.database != nil {
		scopes, err := s.queryPG(ctx, tenantID, sessionID)
		if err == nil {
			return scopes
		}
	}
	if u := strings.TrimSpace(s.remoteURL); u != "" && gatewayinternal.IsHTTPURL(u) {
		s.refreshRemote(u)
		s.mu.RLock()
		defer s.mu.RUnlock()
		return append([]string(nil), s.snapshot[sessionID]...)
	}
	return nil
}

func (s *SessionGrantStore) queryPG(ctx context.Context, tenantID, sessionID string) ([]string, error) {
	if s.database == nil {
		return nil, context.Canceled
	}
	var raw []byte
	row, err := s.database.QueryRowContext(ctx, `
SELECT scopes FROM session_grants
WHERE tenant_id = ? AND session_id = ?
  AND revoked_at IS NULL AND expires_at > CURRENT_TIMESTAMP
ORDER BY expires_at DESC LIMIT 1`, tenantID, sessionID)
	if err != nil {
		return nil, err
	}
	err = row.Scan(&raw)
	if err != nil {
		return nil, err
	}
	return parseScopesJSON(raw), nil
}

type sessionGrantSnapshot struct {
	UpdatedAt string              `json:"updatedAt"`
	Grants    map[string][]string `json:"grants"`
}

func (s *SessionGrantStore) refreshRemote(url string) {
	s.mu.RLock()
	if !s.fetchedAt.IsZero() && time.Since(s.fetchedAt) < s.cacheTTL {
		s.mu.RUnlock()
		return
	}
	s.mu.RUnlock()

	raw, code, err := gatewayinternal.HTTPGet(url)
	if err != nil || code < 200 || code >= 300 {
		if err != nil {
			log.Printf("[session-grant] remote fetch failed: %v", err)
		}
		return
	}
	var snap sessionGrantSnapshot
	if err := json.Unmarshal(raw, &snap); err != nil {
		log.Printf("[session-grant] parse snapshot failed: %v", err)
		return
	}
	if snap.Grants == nil {
		snap.Grants = map[string][]string{}
	}
	s.mu.Lock()
	s.snapshot = snap.Grants
	s.fetchedAt = time.Now()
	s.mu.Unlock()
}

// MergeScopes returns deduplicated union of base and extra scopes.
func MergeScopes(base, extra []string) []string {
	seen := map[string]struct{}{}
	out := make([]string, 0, len(base)+len(extra))
	for _, scope := range append(base, extra...) {
		scope = strings.TrimSpace(scope)
		if scope == "" {
			continue
		}
		if _, ok := seen[scope]; ok {
			continue
		}
		seen[scope] = struct{}{}
		out = append(out, scope)
	}
	return out
}

func HasScope(scopes []string, required string) bool {
	for _, scope := range scopes {
		if scope == required {
			return true
		}
	}
	return false
}

func patCacheTTLFromEnv() time.Duration {
	raw := strings.TrimSpace(os.Getenv("GATEWAY_PAT_CACHE_TTL"))
	if raw == "" {
		return 5 * time.Second
	}
	d, err := time.ParseDuration(raw)
	if err != nil || d <= 0 {
		return 5 * time.Second
	}
	return d
}
