package auth

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"
)

func TestPATVerifierLoadsTrustedEmailAndScopes(t *testing.T) {
	token := "agx-pat-identity-demo"
	hash := hashPAT(token)
	v := &PATVerifier{
		cache: map[string]patCacheEntry{},
		ttl:   time.Minute,
	}
	v.withLookup(func(ctx context.Context, tokenHash string) (patTokenRow, error) {
		if tokenHash != hash {
			t.Fatalf("unexpected hash %s", tokenHash)
		}
		return patTokenRow{
			ID:         42,
			TenantID:   "tenant-a",
			UserID:     "user-a",
			DeptID:     "dept-a",
			Status:     "active",
			Scopes:     []byte(`["workspace:chat","desktop:managed"]`),
			UserEmail:  "alice@example.invalid",
			UserStatus: "active",
		}, nil
	})

	got, err := v.Verify(context.Background(), token)
	if err != nil {
		t.Fatalf("verify: %v", err)
	}
	if got.UserEmail != "alice@example.invalid" {
		t.Fatalf("email=%q", got.UserEmail)
	}
	if got.TenantID != "tenant-a" || got.UserID != "user-a" || got.DeptID != "dept-a" {
		t.Fatalf("identity fields mismatch: %+v", got)
	}
	if !HasScope(got.Scopes, "desktop:managed") || !HasScope(got.Scopes, "workspace:chat") {
		t.Fatalf("scopes=%v", got.Scopes)
	}

	// Cache hit must preserve email + scopes (no second lookup needed).
	v.lookup = func(ctx context.Context, tokenHash string) (patTokenRow, error) {
		return patTokenRow{}, errors.New("lookup should not run on cache hit")
	}
	cached, err := v.Verify(context.Background(), token)
	if err != nil {
		t.Fatalf("cached verify: %v", err)
	}
	if cached.UserEmail != "alice@example.invalid" {
		t.Fatalf("cached email=%q", cached.UserEmail)
	}
	if !HasScope(cached.Scopes, "desktop:managed") {
		t.Fatalf("cached scopes=%v", cached.Scopes)
	}
}

func TestPATVerifierRejectsInactiveUser(t *testing.T) {
	token := "agx-pat-inactive-user"
	v := &PATVerifier{cache: map[string]patCacheEntry{}, ttl: time.Minute}
	v.withLookup(func(ctx context.Context, tokenHash string) (patTokenRow, error) {
		return patTokenRow{
			ID:         1,
			TenantID:   "t1",
			UserID:     "u1",
			Status:     "active",
			Scopes:     []byte(`["workspace:chat"]`),
			UserEmail:  "bob@example.invalid",
			UserStatus: "disabled",
		}, nil
	})
	_, err := v.Verify(context.Background(), token)
	if err == nil || !strings.Contains(err.Error(), "user_inactive") {
		t.Fatalf("expected user_inactive, got %v", err)
	}
}

func TestPATVerifierExpiredAndRevokedUnchanged(t *testing.T) {
	expired := time.Now().UTC().Add(-time.Hour)
	v := &PATVerifier{cache: map[string]patCacheEntry{}, ttl: time.Minute}
	v.withLookup(func(ctx context.Context, tokenHash string) (patTokenRow, error) {
		return patTokenRow{
			ID:         1,
			TenantID:   "t1",
			UserID:     "u1",
			Status:     "active",
			Scopes:     []byte(`["workspace:chat"]`),
			ExpireAt:   &expired,
			UserEmail:  "bob@example.invalid",
			UserStatus: "active",
		}, nil
	})
	_, err := v.Verify(context.Background(), "agx-pat-expired")
	if err == nil || !strings.Contains(err.Error(), "expired") {
		t.Fatalf("expected expired, got %v", err)
	}

	v2 := &PATVerifier{cache: map[string]patCacheEntry{}, ttl: time.Minute}
	v2.withLookup(func(ctx context.Context, tokenHash string) (patTokenRow, error) {
		return patTokenRow{
			ID:     2,
			Status: "revoked",
		}, nil
	})
	_, err = v2.Verify(context.Background(), "agx-pat-revoked-row")
	if err == nil || !strings.Contains(err.Error(), "revoked") {
		t.Fatalf("expected revoked, got %v", err)
	}
}
