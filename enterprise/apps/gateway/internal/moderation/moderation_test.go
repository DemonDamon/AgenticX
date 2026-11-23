package moderation

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func slogNop() *slog.Logger {
	return slog.New(slog.DiscardHandler)
}

func TestHTTPProviderContract(t *testing.T) {
	var gotBody map[string]any
	var gotAuth string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotAuth = r.Header.Get("Authorization")
		if err := json.NewDecoder(r.Body).Decode(&gotBody); err != nil {
			t.Errorf("decode request body: %v", err)
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		_, _ = w.Write([]byte(`{"blocked":true,"categories":["porn"],"score":0.97,"detail":"命中色情类别"}`))
	}))
	defer srv.Close()

	p := NewHTTPProvider("vendor-x", srv.URL, "secret-key", 2*time.Second)
	verdict, err := p.Check(context.Background(), CheckRequest{
		TenantID:   "tenant-1",
		Stage:      "request",
		Text:       "some text",
		Categories: []string{"porn"},
	})
	if err != nil {
		t.Fatalf("check: %v", err)
	}
	if !verdict.Blocked {
		t.Fatalf("expected blocked verdict")
	}
	if len(verdict.Categories) != 1 || verdict.Categories[0] != "porn" {
		t.Fatalf("expected categories [porn], got %v", verdict.Categories)
	}
	if verdict.Score != 0.97 {
		t.Fatalf("expected score 0.97, got %v", verdict.Score)
	}
	if gotAuth != "Bearer secret-key" {
		t.Fatalf("expected bearer auth, got %q", gotAuth)
	}
	if gotBody["tenantId"] != "tenant-1" || gotBody["stage"] != "request" || gotBody["text"] != "some text" {
		t.Fatalf("unexpected request contract body: %v", gotBody)
	}
}

func TestHTTPProviderBadStatusIsError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer srv.Close()

	p := NewHTTPProvider("vendor-x", srv.URL, "", time.Second)
	if _, err := p.Check(context.Background(), CheckRequest{TenantID: "t", Stage: "request", Text: "x"}); err == nil {
		t.Fatalf("expected error on http 500")
	}
}

func TestHTTPProviderTimeout(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		time.Sleep(300 * time.Millisecond)
		_, _ = w.Write([]byte(`{"blocked":false}`))
	}))
	defer srv.Close()

	p := NewHTTPProvider("vendor-x", srv.URL, "", 50*time.Millisecond)
	if _, err := p.Check(context.Background(), CheckRequest{TenantID: "t", Stage: "request", Text: "x"}); err == nil {
		t.Fatalf("expected timeout error")
	}
}

func writeModerationFile(t *testing.T, content string) string {
	t.Helper()
	dir := t.TempDir()
	file := filepath.Join(dir, "moderation.json")
	if err := os.WriteFile(file, []byte(content), 0o600); err != nil {
		t.Fatalf("write moderation file: %v", err)
	}
	t.Setenv("GATEWAY_ADMIN_MODERATION_FILE", file)
	return file
}

func TestEnforceDegradedFailsOpenWithAlertSignal(t *testing.T) {
	// provider URL 无法连接：degraded 模式必须放行（Degraded=true 由调用方发告警）。
	writeModerationFile(t, `{"tenants":{"tenant-1":{"enabled":true,"mode":"degraded",
		"provider":{"type":"http","name":"vendor-x","url":"http://127.0.0.1:1/check"}}}}`)
	loader := NewConfigLoader(slogNop())
	if err := loader.Reload(); err != nil {
		t.Fatalf("reload: %v", err)
	}
	svc := NewService(loader, slogNop())

	result := svc.Enforce(context.Background(), "tenant-1", "request", "hello")
	if !result.Checked {
		t.Fatalf("expected checked")
	}
	if result.Blocked {
		t.Fatalf("degraded must not block")
	}
	if !result.Degraded {
		t.Fatalf("expected degraded signal for CRITICAL alert")
	}
}

func TestEnforceStrictFailsClosed(t *testing.T) {
	writeModerationFile(t, `{"tenants":{"tenant-1":{"enabled":true,"mode":"strict",
		"provider":{"type":"http","name":"vendor-x","url":"http://127.0.0.1:1/check"}}}}`)
	loader := NewConfigLoader(slogNop())
	if err := loader.Reload(); err != nil {
		t.Fatalf("reload: %v", err)
	}
	svc := NewService(loader, slogNop())

	result := svc.Enforce(context.Background(), "tenant-1", "request", "hello")
	if !result.Blocked {
		t.Fatalf("strict mode must fail closed")
	}
	if result.Hit.Category != "moderation" || result.Hit.RuleID != "moderation_strict_fail_closed" {
		t.Fatalf("unexpected strict hit: %+v", result.Hit)
	}
	if string(result.Hit.Action) != "block" {
		t.Fatalf("expected block action, got %s", result.Hit.Action)
	}
}

func TestEnforceBlockedVerdictSynthesizesHit(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`{"blocked":true,"categories":["porn"],"score":0.9}`))
	}))
	defer srv.Close()
	file := writeModerationFile(t, `{"tenants":{"tenant-1":{"enabled":true,"mode":"degraded",
		"blockSeverity":"high","categories":["politics","porn"],
		"provider":{"type":"http","name":"vendor-x","url":"`+srv.URL+`"}}}}`)
	_ = file
	loader := NewConfigLoader(slogNop())
	if err := loader.Reload(); err != nil {
		t.Fatalf("reload: %v", err)
	}
	svc := NewService(loader, slogNop())

	result := svc.Enforce(context.Background(), "tenant-1", "response", "bad content")
	if !result.Blocked {
		t.Fatalf("expected blocked")
	}
	if result.Hit.Category != "porn" {
		t.Fatalf("expected category porn, got %q", result.Hit.Category)
	}
	if result.Hit.Severity != "high" {
		t.Fatalf("expected configured severity high, got %q", result.Hit.Severity)
	}
	if result.Hit.Stage != "response" {
		t.Fatalf("expected stage response, got %q", result.Hit.Stage)
	}
	if !strings.Contains(result.Hit.RuleID, "vendor-x") {
		t.Fatalf("expected provider name in rule id, got %q", result.Hit.RuleID)
	}
}

func TestEnforceUnconfiguredTenantIsNoop(t *testing.T) {
	file := writeModerationFile(t, `{"tenants":{}}`)
	loader := NewConfigLoader(slogNop())
	t.Setenv("GATEWAY_ADMIN_MODERATION_FILE", file)
	if err := loader.Reload(); err != nil {
		t.Fatalf("reload: %v", err)
	}
	svc := NewService(loader, slogNop())

	var called int
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		called++
		_, _ = w.Write([]byte(`{"blocked":false}`))
	}))
	defer srv.Close()
	_ = srv

	result := svc.Enforce(context.Background(), "unknown-tenant", "request", "hello")
	if result.Checked || result.Blocked || result.Degraded {
		t.Fatalf("unconfigured tenant must be noop, got %+v", result)
	}
}

func TestConfigFileMissingIsEmpty(t *testing.T) {
	loader := NewConfigLoader(slogNop())
	t.Setenv("GATEWAY_ADMIN_MODERATION_FILE", filepath.Join(t.TempDir(), "missing.json"))
	if err := loader.Reload(); err != nil {
		t.Fatalf("reload missing file: %v", err)
	}
	if loader.Tenants() != 0 {
		t.Fatalf("expected 0 tenants")
	}
	if _, ok := loader.Config("any"); ok {
		t.Fatalf("expected no config")
	}
}
