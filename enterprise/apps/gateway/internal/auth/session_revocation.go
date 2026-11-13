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

// SessionRevocationSnapshot is pulled from admin-console internal API（SP5）。
type SessionRevocationSnapshot struct {
	Version           int64    `json:"version"`
	RevokedSessionIds []string `json:"revokedSessionIds"`
	UpdatedAt         string   `json:"updatedAt"`
}

// SessionRevocationStore tracks revoked JWT session ids for near-realtime invalidation.
// 登录 access token 是无状态 RS256 JWT，会话击杀依赖该存储：处置端点 InvalidateLocal
// 即时生效，console snapshot 轮询兜底（重启恢复/多副本感知）。
type SessionRevocationStore struct {
	remoteURL string
	mu        sync.RWMutex
	version   int64
	revoked   map[string]struct{}
	fetchedAt time.Time
	cacheTTL  time.Duration
}

func NewSessionRevocationStore() *SessionRevocationStore {
	return &SessionRevocationStore{
		remoteURL: strings.TrimSpace(os.Getenv("GATEWAY_REMOTE_SESSION_REVOCATION_URL")),
		revoked:   map[string]struct{}{},
		cacheTTL:  5 * time.Second,
	}
}

// IsRevoked returns true when the JWT session was terminated by an incident action.
func (s *SessionRevocationStore) IsRevoked(sessionID string) bool {
	sessionID = strings.TrimSpace(sessionID)
	if sessionID == "" {
		return false
	}
	s.refreshIfNeeded()
	s.mu.RLock()
	defer s.mu.RUnlock()
	_, ok := s.revoked[sessionID]
	return ok
}

func (s *SessionRevocationStore) refreshIfNeeded() {
	u := strings.TrimSpace(s.remoteURL)
	if u == "" || !gatewayinternal.IsHTTPURL(u) {
		return
	}
	s.mu.RLock()
	stale := s.fetchedAt.IsZero() || time.Since(s.fetchedAt) >= s.cacheTTL
	s.mu.RUnlock()
	if !stale {
		return
	}
	raw, code, err := gatewayinternal.HTTPGet(u)
	if err != nil || code < 200 || code >= 300 {
		if err != nil {
			log.Printf("[session-revocation] remote fetch failed: %v", err)
		}
		return
	}
	var snap SessionRevocationSnapshot
	if err := json.Unmarshal(raw, &snap); err != nil {
		log.Printf("[session-revocation] parse failed: %v", err)
		return
	}
	next := map[string]struct{}{}
	for _, id := range snap.RevokedSessionIds {
		id = strings.TrimSpace(id)
		if id != "" {
			next[id] = struct{}{}
		}
	}
	s.mu.Lock()
	s.version = snap.Version
	s.revoked = next
	s.fetchedAt = time.Now()
	s.mu.Unlock()
}

// InvalidateLocal terminates a JWT session immediately in this gateway replica.
func (s *SessionRevocationStore) InvalidateLocal(sessionID string) {
	sessionID = strings.TrimSpace(sessionID)
	if sessionID == "" {
		return
	}
	s.mu.Lock()
	s.revoked[sessionID] = struct{}{}
	s.version++
	s.mu.Unlock()
}
