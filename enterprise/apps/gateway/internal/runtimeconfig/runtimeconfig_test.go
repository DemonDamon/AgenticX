package runtimeconfig

import (
	"context"
	"log/slog"
	"os"
	"path/filepath"
	"testing"
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
