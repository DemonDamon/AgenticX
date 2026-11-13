package mcphost

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"log/slog"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/agenticx/enterprise/gateway/internal/gatewayinternal"
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

type sessionClaims struct {
	S   string `json:"s"`
	T   string `json:"t"`
	U   string `json:"u"`
	Iat int64  `json:"iat"`
	Exp int64  `json:"exp"`
}

func newSSESessionStore() *sseSessionStore {
	return &sseSessionStore{sessions: map[string]sseSession{}}
}

func (s *sseSessionStore) Create(serverName string, identity Identity) string {
	id := newSessionID(serverName, identity)
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
	if ok {
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
	// 本地没有这条会话时才验签。通过后不写回 map：Remove 只发生在持有
	// SSE 连接的副本上，写回后无人删除，还会用 30 分钟本地规则盖住签名有效期。
	secret := gatewayinternal.SecretFromEnv("GATEWAY_MCP_SESSION_SECRET")
	if secret == "" {
		return false
	}
	claims, signed := decodeSessionID(secret, id)
	if !signed {
		return false
	}
	if time.Now().Unix() >= claims.Exp {
		return false
	}
	if claims.S != serverName {
		return false
	}
	if claims.T != identity.TenantID || claims.U != identity.UserID {
		return false
	}
	return true
}

func (s *sseSessionStore) Remove(id string) {
	s.mu.Lock()
	delete(s.sessions, id)
	s.mu.Unlock()
}

var warnMCPSessionSecretOnce sync.Once

func warnIfMCPSessionSecretUnset() {
	warnMCPSessionSecretOnce.Do(func() {
		if gatewayinternal.SecretFromEnv("GATEWAY_MCP_SESSION_SECRET") == "" {
			slog.Warn("MCP SSE sessions stay process-local until GATEWAY_MCP_SESSION_SECRET is set; multi-replica deployments need it to validate session ids")
		}
	})
}

func newSessionID(serverName string, identity Identity) string {
	secret := gatewayinternal.SecretFromEnv("GATEWAY_MCP_SESSION_SECRET")
	if secret == "" {
		return hashText(serverName + identity.UserID + time.Now().String())
	}
	now := time.Now()
	id, err := encodeSessionID(secret, sessionClaims{
		S:   serverName,
		T:   identity.TenantID,
		U:   identity.UserID,
		Iat: now.Unix(),
		Exp: now.Add(mcpSessionTTL()).Unix(),
	})
	if err != nil {
		return hashText(serverName + identity.UserID + now.String())
	}
	return id
}

func mcpSessionTTL() time.Duration {
	const fallback = 24 * time.Hour
	raw := strings.TrimSpace(os.Getenv("GATEWAY_MCP_SESSION_TTL"))
	if raw == "" {
		return fallback
	}
	d, err := time.ParseDuration(raw)
	if err != nil || d <= 0 {
		return fallback
	}
	return d
}

func encodeSessionID(secret string, claims sessionClaims) (string, error) {
	payload, err := json.Marshal(claims)
	if err != nil {
		return "", err
	}
	mac := sessionMAC(secret, payload)
	return "v1." + base64.RawURLEncoding.EncodeToString(payload) + "." + base64.RawURLEncoding.EncodeToString(mac), nil
}

func decodeSessionID(secret, id string) (sessionClaims, bool) {
	parts := strings.Split(id, ".")
	if len(parts) != 3 || parts[0] != "v1" {
		return sessionClaims{}, false
	}
	payload, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return sessionClaims{}, false
	}
	mac, err := base64.RawURLEncoding.DecodeString(parts[2])
	if err != nil {
		return sessionClaims{}, false
	}
	if !hmac.Equal(mac, sessionMAC(secret, payload)) {
		return sessionClaims{}, false
	}
	var claims sessionClaims
	if err := json.Unmarshal(payload, &claims); err != nil {
		return sessionClaims{}, false
	}
	return claims, true
}

func sessionMAC(secret string, payload []byte) []byte {
	mac := hmac.New(sha256.New, []byte(secret))
	_, _ = mac.Write(payload)
	return mac.Sum(nil)
}
