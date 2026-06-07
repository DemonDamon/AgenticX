package auth

import (
	"context"
	"strings"
	"testing"
	"time"
)

func TestMergeScopesAndHasScope(t *testing.T) {
	merged := MergeScopes([]string{"workspace:chat"}, []string{"metering:read", "workspace:chat"})
	if len(merged) != 2 {
		t.Fatalf("expected 2 scopes, got %v", merged)
	}
	if !HasScope(merged, "metering:read") {
		t.Fatal("expected metering:read")
	}
}

func TestPATRevocationStoreLocalInvalidate(t *testing.T) {
	store := NewPATRevocationStore()
	hash := hashPAT("agx-pat-testtoken")
	if store.IsRevoked(hash) {
		t.Fatal("should not be revoked initially")
	}
	store.InvalidateLocal(hash)
	if !store.IsRevoked(hash) {
		t.Fatal("expected revoked after local invalidate")
	}
}

func TestSessionGrantTemporaryScopeAccess(t *testing.T) {
	base := []string{"workspace:chat"}
	temp := []string{"metering:read"}
	merged := MergeScopes(base, temp)
	if !HasScope(merged, "metering:read") {
		t.Fatal("expected temp scope within TTL window")
	}
	if HasScope(base, "metering:read") {
		t.Fatal("base scopes should not include temp grant")
	}
}

func TestPatCacheTTLDefault(t *testing.T) {
	t.Setenv("GATEWAY_PAT_CACHE_TTL", "")
	if patCacheTTLFromEnv() != 5*time.Second {
		t.Fatalf("expected 5s default")
	}
}

func TestPATVerifierRespectsRevocationBeforeCache(t *testing.T) {
	store := NewPATRevocationStore()
	hash := hashPAT("agx-pat-revoked-demo")
	store.InvalidateLocal(hash)
	v := &PATVerifier{
		cache:           map[string]patCacheEntry{},
		ttl:             time.Minute,
		revocationStore: store,
	}
	v.storeCache(hash, patCacheEntry{
		identity: PATIdentity{UserID: "u1", Scopes: []string{"workspace:chat"}},
		expires:  time.Now().Add(time.Minute),
	})
	_, err := v.Verify(context.Background(), "agx-pat-revoked-demo")
	if err == nil || !strings.Contains(err.Error(), "revoked") {
		t.Fatalf("expected revoked error, got %v", err)
	}
}
