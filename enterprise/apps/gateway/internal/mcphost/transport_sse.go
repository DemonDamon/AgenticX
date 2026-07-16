package mcphost

import (
	"sync"
	"time"
)

type sseSession struct {
	serverName string
	userID     string
	tokenID    int64
	created    time.Time
}

type sseSessionStore struct {
	mu       sync.RWMutex
	sessions map[string]sseSession
}

func newSSESessionStore() *sseSessionStore {
	return &sseSessionStore{sessions: map[string]sseSession{}}
}

func (s *sseSessionStore) Create(serverName string, identity Identity) string {
	id := hashText(serverName + identity.UserID + time.Now().String())
	s.mu.Lock()
	s.sessions[id] = sseSession{
		serverName: serverName,
		userID:     identity.UserID,
		tokenID:    identity.APITokenID,
		created:    time.Now(),
	}
	s.mu.Unlock()
	return id
}

func (s *sseSessionStore) Valid(id, serverName string, identity Identity) bool {
	s.mu.RLock()
	sess, ok := s.sessions[id]
	s.mu.RUnlock()
	if !ok {
		return false
	}
	if sess.serverName != serverName {
		return false
	}
	if sess.userID != identity.UserID {
		return false
	}
	if sess.tokenID != identity.APITokenID {
		return false
	}
	return time.Since(sess.created) < 30*time.Minute
}

func (s *sseSessionStore) Remove(id string) {
	s.mu.Lock()
	delete(s.sessions, id)
	s.mu.Unlock()
}
