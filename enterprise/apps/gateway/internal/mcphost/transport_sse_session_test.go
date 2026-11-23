package mcphost

import (
	"encoding/base64"
	"encoding/json"
	"strings"
	"testing"
	"time"
)

func setSessionPhrase(t *testing.T, phrase string) {
	t.Helper()
	t.Setenv("GATEWAY_MCP_SESSION_SECRET", phrase)
	t.Setenv("GATEWAY_MCP_SESSION_SECRET_FILE", "")
}

func clearSessionPhrase(t *testing.T) {
	t.Helper()
	t.Setenv("GATEWAY_MCP_SESSION_SECRET", "")
	t.Setenv("GATEWAY_MCP_SESSION_SECRET_FILE", "")
	t.Setenv("GATEWAY_MCP_SESSION_TTL", "")
}

func testIdentity(tokenID int64) Identity {
	return Identity{TenantID: "tenant-a", UserID: "user-a", APITokenID: tokenID}
}

func TestSignedSessionValidAcrossStores(t *testing.T) {
	setSessionPhrase(t, "test-phrase-a")
	t.Setenv("GATEWAY_MCP_SESSION_TTL", "")

	a := newSSESessionStore()
	b := newSSESessionStore()
	identity := testIdentity(7)
	id := a.Create("demo-server", identity)
	parts := strings.Split(id, ".")
	if !strings.HasPrefix(id, "v1.") || len(parts) != 3 {
		t.Fatalf("session id = %q, want v1 payload mac", id)
	}
	if !a.Valid(id, "demo-server", identity) {
		t.Fatal("issuing store rejected its own session")
	}
	if !b.Valid(id, "demo-server", identity) {
		t.Fatal("other store rejected a signed session")
	}
	if a.Valid(id, "demo-server", testIdentity(8)) {
		t.Fatal("local hit accepted a different API token")
	}
	if !b.Valid(id, "demo-server", testIdentity(8)) {
		t.Fatal("signed session required API token on a store that has no local entry")
	}

	a.Remove(id)
	if !b.Valid(id, "demo-server", identity) {
		t.Fatal("remove on the issuing store invalidated the other store")
	}
}

func TestSignedSessionRejectsTamperExpiryUserAndServer(t *testing.T) {
	setSessionPhrase(t, "test-phrase-a")
	a := newSSESessionStore()
	b := newSSESessionStore()
	identity := testIdentity(7)
	id := a.Create("demo-server", identity)

	parts := strings.Split(id, ".")
	payload, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		t.Fatal(err)
	}
	payload[0] ^= 0x01
	parts[1] = base64.RawURLEncoding.EncodeToString(payload)
	if b.Valid(strings.Join(parts, "."), "demo-server", identity) {
		t.Fatal("tampered payload was accepted")
	}

	past := time.Now().Unix() - 30
	expired, err := encodeSessionID("test-phrase-a", sessionClaims{
		S:   "demo-server",
		T:   "tenant-a",
		U:   "user-a",
		Iat: past - 10,
		Exp: past,
	})
	if err != nil {
		t.Fatal(err)
	}
	if b.Valid(expired, "demo-server", identity) {
		t.Fatal("expired session was accepted")
	}

	otherUser := identity
	otherUser.UserID = "user-b"
	if b.Valid(id, "demo-server", otherUser) {
		t.Fatal("different user was accepted")
	}
	if b.Valid(id, "other-server", identity) {
		t.Fatal("different server was accepted")
	}
}

func TestSignedSessionRejectsMalformedID(t *testing.T) {
	setSessionPhrase(t, "test-phrase-a")
	a := newSSESessionStore()
	b := newSSESessionStore()
	identity := testIdentity(7)
	id := a.Create("demo-server", identity)
	parts := strings.Split(id, ".")
	cases := []string{
		"",
		"v1.only",
		"v1.a.b.c",
		"v2." + parts[1] + "." + parts[2],
		"v1.***.***",
	}
	for _, bad := range cases {
		if b.Valid(bad, "demo-server", identity) {
			t.Fatalf("malformed id %q was accepted", bad)
		}
	}
}

func TestUnsignedSessionRejectedByOtherStore(t *testing.T) {
	clearSessionPhrase(t)
	a := newSSESessionStore()
	b := newSSESessionStore()
	identity := testIdentity(7)
	id := a.Create("demo-server", identity)
	if strings.HasPrefix(id, "v1.") {
		t.Fatalf("unsigned session id = %q", id)
	}
	if !a.Valid(id, "demo-server", identity) {
		t.Fatal("issuing store rejected an unsigned session")
	}
	if b.Valid(id, "demo-server", identity) {
		t.Fatal("other store accepted an unsigned session")
	}
	a.Remove(id)
	if a.Valid(id, "demo-server", identity) {
		t.Fatal("removed unsigned session was still valid")
	}
}

func TestSignedSessionTTLFromEnv(t *testing.T) {
	setSessionPhrase(t, "test-phrase-a")
	store := newSSESessionStore()
	identity := testIdentity(7)

	t.Setenv("GATEWAY_MCP_SESSION_TTL", "1h")
	claims := claimsFromID(t, store.Create("demo-server", identity))
	if claims.Exp-claims.Iat != 3600 {
		t.Fatalf("exp-iat = %d, want 3600", claims.Exp-claims.Iat)
	}

	t.Setenv("GATEWAY_MCP_SESSION_TTL", "not-a-duration")
	claims = claimsFromID(t, store.Create("demo-server", identity))
	if claims.Exp-claims.Iat != 86400 {
		t.Fatalf("exp-iat = %d, want 86400", claims.Exp-claims.Iat)
	}
}

func claimsFromID(t *testing.T, id string) sessionClaims {
	t.Helper()
	parts := strings.Split(id, ".")
	if len(parts) != 3 {
		t.Fatalf("session id = %q", id)
	}
	payload, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		t.Fatal(err)
	}
	var claims sessionClaims
	if err := json.Unmarshal(payload, &claims); err != nil {
		t.Fatal(err)
	}
	return claims
}
