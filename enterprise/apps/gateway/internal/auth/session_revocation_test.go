package auth

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

// SP5 incident-response: JWT session 吊销存储单元测试。

func TestSessionRevocationLocalImmediate(t *testing.T) {
	t.Setenv("GATEWAY_REMOTE_SESSION_REVOCATION_URL", "")
	s := NewSessionRevocationStore()
	if s.IsRevoked("sess-1") {
		t.Fatal("fresh store revoked unknown session")
	}
	s.InvalidateLocal("sess-1")
	if !s.IsRevoked("sess-1") {
		t.Fatal("InvalidateLocal did not revoke session")
	}
	if s.IsRevoked("sess-2") {
		t.Fatal("unrelated session revoked")
	}
}

func TestSessionRevocationEmptyIDNeverRevoked(t *testing.T) {
	t.Setenv("GATEWAY_REMOTE_SESSION_REVOCATION_URL", "")
	s := NewSessionRevocationStore()
	s.InvalidateLocal("   ")
	if s.IsRevoked("") {
		t.Fatal("empty session id must never be revoked (PAT path has no session)")
	}
}

func TestSessionRevocationSnapshotFetch(t *testing.T) {
	var served int
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		served++
		w.Write([]byte(`{"version":3,"revokedSessionIds":["sess-remote"," sess-pad "],"updatedAt":"2026-11-13T00:00:00Z"}`))
	}))
	defer srv.Close()
	t.Setenv("GATEWAY_REMOTE_SESSION_REVOCATION_URL", srv.URL)
	s := NewSessionRevocationStore()
	if !s.IsRevoked("sess-remote") {
		t.Fatal("snapshot not fetched")
	}
	if !s.IsRevoked("sess-pad") {
		t.Fatal("snapshot entries not trimmed")
	}
	if s.IsRevoked("sess-unknown") {
		t.Fatal("unknown session revoked")
	}
	if served == 0 {
		t.Fatal("no snapshot HTTP request made")
	}
}

func TestSessionRevocationFetchFailureKeepsOldList(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer srv.Close()
	t.Setenv("GATEWAY_REMOTE_SESSION_REVOCATION_URL", srv.URL)
	s := NewSessionRevocationStore()
	// 本地吊销先建立已知态。
	s.InvalidateLocal("sess-local")
	if !s.IsRevoked("sess-local") {
		t.Fatal("local revocation missing")
	}
	// 轮询失败：保留旧列表（fail-safe），不 panic 不清空。
	if !s.IsRevoked("sess-local") {
		t.Fatal("failed fetch dropped local revocations")
	}
}

func TestSessionRevocationSnapshotVersionRefresh(t *testing.T) {
	s := NewSessionRevocationStore()
	s.cacheTTL = 80 * time.Millisecond // 测试加速：不动 5s 生产默认
	first := make(chan struct{}, 1)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		select {
		case <-first:
			w.Write([]byte(`{"version":2,"revokedSessionIds":["sess-b"],"updatedAt":"t2"}`))
		default:
			first <- struct{}{}
			w.Write([]byte(`{"version":1,"revokedSessionIds":["sess-a"],"updatedAt":"t1"}`))
		}
	}))
	defer srv.Close()
	s.remoteURL = srv.URL
	if !s.IsRevoked("sess-a") {
		t.Fatal("first snapshot not applied")
	}
	if s.IsRevoked("sess-b") {
		t.Fatal("TTL 内 snapshot 应保持旧数据")
	}
	// 等待 TTL 过期后重新拉取：列表切换到新快照。
	time.Sleep(120 * time.Millisecond)
	if !s.IsRevoked("sess-b") {
		t.Fatal("second snapshot not applied after TTL")
	}
	if s.IsRevoked("sess-a") {
		t.Fatal("old revocation should be replaced by fresh snapshot")
	}
}
