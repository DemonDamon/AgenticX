package metering

import (
	"net/url"
	"strings"
	"testing"
)

func TestEnsureSSLMode_URL_AddsDisableWhenMissing(t *testing.T) {
	got := ensureSSLMode("postgresql://postgres:postgres@127.0.0.1:5432/agenticx")
	parsed, err := url.Parse(got)
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	if parsed.Query().Get("sslmode") != "disable" {
		t.Fatalf("expected sslmode=disable, got %q", got)
	}
}

func TestEnsureSSLMode_URL_PreservesExplicitSSLMode(t *testing.T) {
	got := ensureSSLMode("postgresql://postgres:postgres@db/agenticx?sslmode=require")
	parsed, err := url.Parse(got)
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	if parsed.Query().Get("sslmode") != "require" {
		t.Fatalf("expected sslmode preserved as require, got %q", got)
	}
}

func TestEnsureSSLMode_KV_AddsDisableWhenMissing(t *testing.T) {
	got := ensureSSLMode("host=127.0.0.1 user=postgres dbname=agenticx")
	if !strings.Contains(got, "sslmode=disable") {
		t.Fatalf("expected sslmode=disable to be appended, got %q", got)
	}
}

func TestEnsureSSLMode_KV_PreservesExplicitSSLMode(t *testing.T) {
	original := "host=db user=postgres dbname=agenticx sslmode=require"
	got := ensureSSLMode(original)
	if got != original {
		t.Fatalf("expected explicit sslmode kept, got %q", got)
	}
}

func TestEnsureSSLMode_EmptyStaysEmpty(t *testing.T) {
	if ensureSSLMode("") != "" {
		t.Fatalf("empty input should stay empty")
	}
}
