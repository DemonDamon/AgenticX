package channel

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestProberListModels(t *testing.T) {
	up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"data":[{"id":"deepseek-chat"},{"id":"deepseek-reasoner"}]}`))
	}))
	defer up.Close()
	prober := NewProber()
	result := prober.Probe(context.Background(), Channel{
		ID:       "ch-1",
		BaseURL:  up.URL + "/v1",
		Metadata: map[string]any{"keyRefs": []any{"k1"}},
	}, map[string]string{"k1": "test-key"})
	if len(result.SupportedModels) != 2 {
		t.Fatalf("models=%v err=%q", result.SupportedModels, result.LastProbeError)
	}
	if len(result.KeyHealth) != 1 || result.KeyHealth[0].Status != "healthy" {
		t.Fatalf("key health=%+v", result.KeyHealth)
	}
}
