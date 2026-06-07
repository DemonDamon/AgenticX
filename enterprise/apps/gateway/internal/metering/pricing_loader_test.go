package metering

import (
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
)

func TestPricingLoaderRemoteSnapshot(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{
			"version":"remote-v3",
			"updatedAt":"2026-06-05T00:00:00Z",
			"default":{"input":1,"output":2},
			"models":{"gpt-4o":[{"input":5,"output":6}]}
		}`))
	}))
	defer server.Close()

	t.Setenv("GATEWAY_REMOTE_PRICING_CONFIG_URL", server.URL)
	loader, err := NewPricingLoader("")
	if err != nil {
		t.Fatalf("new loader: %v", err)
	}
	table := loader.Table()
	if table.ForModel("gpt-4o").Input != 5 {
		t.Fatalf("expected remote input 5 got %v", table.ForModel("gpt-4o").Input)
	}
	if table.Version() != "remote-v3" {
		t.Fatalf("expected version remote-v3 got %q", table.Version())
	}
}

func TestPricingLoaderFallbackWhenRemoteFails(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer server.Close()

	dir := t.TempDir()
	localPath := dir + "/pricing.yaml"
	if err := os.WriteFile(localPath, []byte(`
default:
  input: 0.42
  output: 0.84
models:
  gpt-4o:
    input: 0.99
    output: 1.98
`), 0o600); err != nil {
		t.Fatalf("write local pricing: %v", err)
	}

	t.Setenv("GATEWAY_REMOTE_PRICING_CONFIG_URL", server.URL)
	loader, err := NewPricingLoader(localPath)
	if err != nil {
		t.Fatalf("new loader: %v", err)
	}
	table := loader.Table()
	if table.ForModel("gpt-4o").Input != 0.99 {
		t.Fatalf("expected local fallback input 0.99 got %v", table.ForModel("gpt-4o").Input)
	}
}
