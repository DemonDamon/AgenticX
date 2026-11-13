package runtimeconfig

import (
	"context"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/agenticx/enterprise/gateway/internal/configstatus"
)

func TestResolveByModel_HitProviderModel(t *testing.T) {
	dir := t.TempDir()
	file := filepath.Join(dir, "providers.json")
	if err := os.WriteFile(file, []byte(`{
		"providers": [
			{
				"id": "deepseek",
				"displayName": "DeepSeek",
				"baseUrl": "https://api.deepseek.com/v1",
				"apiKey": "sk-a",
				"enabled": true,
				"isDefault": true,
				"route": "third-party",
				"models": [{ "name": "deepseek-chat", "label": "DS Chat", "enabled": true }]
			}
		]
	}`), 0o600); err != nil {
		t.Fatal(err)
	}
	t.Setenv("GATEWAY_ADMIN_PROVIDERS_FILE", file)

	l := New(slog.New(slog.NewTextHandler(os.Stderr, nil)))
	l.Start(context.Background())

	r, ok := l.ResolveByModel("deepseek-chat", "")
	if !ok {
		t.Fatal("expected hit")
	}
	if r.APIKey != "sk-a" || r.Endpoint != "https://api.deepseek.com/v1" || r.Provider != "deepseek" {
		t.Errorf("unexpected resolution: %+v", r)
	}
}

func TestResolveByModel_DisabledProviderSkipped(t *testing.T) {
	dir := t.TempDir()
	file := filepath.Join(dir, "providers.json")
	if err := os.WriteFile(file, []byte(`{
		"providers": [
			{ "id": "x", "baseUrl": "https://x", "apiKey": "k", "enabled": false, "route": "third-party",
			  "models": [{ "name": "m", "label": "M", "enabled": true }] }
		]
	}`), 0o600); err != nil {
		t.Fatal(err)
	}
	t.Setenv("GATEWAY_ADMIN_PROVIDERS_FILE", file)
	l := New(slog.New(slog.NewTextHandler(os.Stderr, nil)))
	l.Start(context.Background())
	if _, ok := l.ResolveByModel("m", ""); ok {
		t.Error("expected miss when provider disabled")
	}
}

func TestResolveByModel_FileMissingFallsBackEmpty(t *testing.T) {
	t.Setenv("GATEWAY_ADMIN_PROVIDERS_FILE", filepath.Join(t.TempDir(), "no-such-file.json"))
	l := New(slog.New(slog.NewTextHandler(os.Stderr, nil)))
	l.Start(context.Background())
	if _, ok := l.ResolveByModel("anything", ""); ok {
		t.Error("expected no hit when file missing")
	}
}

func TestResolveByModel_PrefersDefaultOnTie(t *testing.T) {
	dir := t.TempDir()
	file := filepath.Join(dir, "providers.json")
	if err := os.WriteFile(file, []byte(`{
		"providers": [
			{ "id": "a", "baseUrl": "https://a", "apiKey": "ka", "enabled": true, "isDefault": false, "route": "third-party",
			  "models": [{ "name": "shared", "label": "X", "enabled": true }] },
			{ "id": "b", "baseUrl": "https://b", "apiKey": "kb", "enabled": true, "isDefault": true, "route": "third-party",
			  "models": [{ "name": "shared", "label": "X", "enabled": true }] }
		]
	}`), 0o600); err != nil {
		t.Fatal(err)
	}
	t.Setenv("GATEWAY_ADMIN_PROVIDERS_FILE", file)
	l := New(slog.New(slog.NewTextHandler(os.Stderr, nil)))
	l.Start(context.Background())
	r, ok := l.ResolveByModel("shared", "")
	if !ok || r.Provider != "b" {
		t.Errorf("expected default provider b, got %+v ok=%v", r, ok)
	}
}

func TestResolveByModel_RespectsExplicitProvider(t *testing.T) {
	dir := t.TempDir()
	file := filepath.Join(dir, "providers.json")
	if err := os.WriteFile(file, []byte(`{
		"providers": [
			{ "id": "a", "baseUrl": "https://a", "apiKey": "ka", "enabled": true, "route": "third-party",
			  "models": [{ "name": "shared", "label": "X", "enabled": true }] },
			{ "id": "b", "baseUrl": "https://b", "apiKey": "kb", "enabled": true, "isDefault": true, "route": "third-party",
			  "models": [{ "name": "shared", "label": "X", "enabled": true }] }
		]
	}`), 0o600); err != nil {
		t.Fatal(err)
	}
	t.Setenv("GATEWAY_ADMIN_PROVIDERS_FILE", file)
	l := New(slog.New(slog.NewTextHandler(os.Stderr, nil)))
	l.Start(context.Background())
	r, ok := l.ResolveByModel("shared", "a")
	if !ok || r.Provider != "a" || r.APIKey != "ka" {
		t.Errorf("expected explicit provider a, got %+v ok=%v", r, ok)
	}
}

func TestReloadKeepsProvidersOnInvalidJSON(t *testing.T) {
	dir := t.TempDir()
	file := filepath.Join(dir, "providers.json")
	body := []byte(`{"providers":[{"id":"p1","baseUrl":"https://example.test/v1","apiKey":"k","enabled":true,"route":"third-party","models":[{"name":"m-keep","enabled":true}]}]}`)
	if err := os.WriteFile(file, body, 0o600); err != nil {
		t.Fatal(err)
	}
	t.Setenv("GATEWAY_REMOTE_PROVIDERS_URL", "")
	t.Setenv("GATEWAY_ADMIN_PROVIDERS_FILE", file)
	status := configstatus.NewRegistry(nil)
	l := New(slog.New(slog.NewTextHandler(io.Discard, nil)))
	l.SetConfigStatus(status)
	if err := l.reload(); err != nil {
		t.Fatal(err)
	}
	if _, ok := l.ResolveByModel("m-keep", ""); !ok {
		t.Fatal("expected hit after valid load")
	}
	if err := os.WriteFile(file, []byte(`{`), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := l.reload(); err == nil {
		t.Fatal("expected parse error")
	}
	if _, ok := l.ResolveByModel("m-keep", ""); !ok {
		t.Fatal("invalid json cleared the last snapshot")
	}
	if lastError(t, status, configstatus.DomainProviders) == "" {
		t.Fatal("expected LastError")
	}
}

func TestReloadKeepsProvidersOnRemote404(t *testing.T) {
	var hits atomic.Int32
	good := []byte(`{"providers":[{"id":"p1","baseUrl":"https://example.test/v1","apiKey":"k","enabled":true,"route":"third-party","models":[{"name":"m-keep","enabled":true}]}]}`)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		if hits.Add(1) == 1 {
			_, _ = w.Write(good)
			return
		}
		w.WriteHeader(http.StatusNotFound)
	}))
	t.Cleanup(srv.Close)
	t.Setenv("GATEWAY_REMOTE_PROVIDERS_URL", srv.URL)
	t.Setenv("GATEWAY_ADMIN_PROVIDERS_FILE", "")
	status := configstatus.NewRegistry(nil)
	l := New(slog.New(slog.NewTextHandler(io.Discard, nil)))
	l.SetConfigStatus(status)
	if err := l.reload(); err != nil {
		t.Fatal(err)
	}
	if _, ok := l.ResolveByModel("m-keep", ""); !ok {
		t.Fatal("expected hit after remote 200")
	}
	err := l.reload()
	if err == nil || !strings.Contains(err.Error(), "remote 404") {
		t.Fatalf("reload err = %v", err)
	}
	if _, ok := l.ResolveByModel("m-keep", ""); !ok {
		t.Fatal("remote 404 cleared the last snapshot")
	}
	if !strings.Contains(lastError(t, status, configstatus.DomainProviders), "remote 404") {
		t.Fatalf("LastError = %q", lastError(t, status, configstatus.DomainProviders))
	}
}

func lastError(t *testing.T, status *configstatus.Registry, domain string) string {
	t.Helper()
	for _, item := range status.Snapshot() {
		if item.Domain == domain {
			return item.LastError
		}
	}
	t.Fatalf("missing domain %s", domain)
	return ""
}
