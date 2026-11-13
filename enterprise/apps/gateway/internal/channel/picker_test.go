package channel

import (
	"context"
	"io"
	"log/slog"
	"math/rand"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/agenticx/enterprise/gateway/internal/configstatus"
	"github.com/agenticx/enterprise/gateway/internal/runtimeconfig"
)

func TestWeightedSampleDistribution(t *testing.T) {
	p := NewPicker(nil, NewStatsStore(), NewAffinityStore(time.Minute))
	p.rng = rand.New(rand.NewSource(42))
	cands := []Channel{
		{ID: "a", Weight: 7},
		{ID: "b", Weight: 3},
	}
	counts := map[string]int{"a": 0, "b": 0}
	const n = 1000
	for i := 0; i < n; i++ {
	 picked := p.weightedSample(cands)
		counts[picked.ID]++
	}
	ratioA := float64(counts["a"]) / float64(n)
	if ratioA < 0.65 || ratioA > 0.75 {
		t.Fatalf("expected ~70%% on channel a, got %.2f (counts=%v)", ratioA, counts)
	}
}

func TestPickAffinityPrefersLastSuccess(t *testing.T) {
	reg := &Registry{}
	channels := []Channel{
		{ID: "a", TenantID: "t1", Status: StatusActive, SupportedModels: []string{"m1"}, Weight: 1},
		{ID: "b", TenantID: "t1", Status: StatusActive, SupportedModels: []string{"m1"}, Weight: 1},
	}
	reg.current.Store(&channels)
	stats := NewStatsStore()
	aff := NewAffinityStore(time.Minute)
	aff.Set("sess1", "m1", "b")
	p := NewPicker(reg, stats, aff)
	ch, ok := p.Pick("m1", Identity{TenantID: "t1", SessionID: "sess1"}, nil)
	if !ok || ch.ID != "b" {
		t.Fatalf("expected affinity channel b, got %+v ok=%v", ch, ok)
	}
}

func TestPickExcludesFailedChannels(t *testing.T) {
	reg := &Registry{}
	channels := []Channel{
		{ID: "a", TenantID: "t1", Status: StatusActive, SupportedModels: []string{"m1"}, Weight: 1},
		{ID: "b", TenantID: "t1", Status: StatusActive, SupportedModels: []string{"m1"}, Weight: 1},
	}
	reg.current.Store(&channels)
	p := NewPicker(reg, NewStatsStore(), NewAffinityStore(time.Minute))
	ch, ok := p.Pick("m1", Identity{TenantID: "t1"}, map[string]struct{}{"a": {}})
	if !ok || ch.ID != "b" {
		t.Fatalf("expected channel b after excluding a, got %+v", ch)
	}
}

func TestStatsCooldown(t *testing.T) {
	stats := NewStatsStore()
	now := time.Now()
	stats.RecordFailure("c1", "upstream 503", 30*time.Second)
	if !stats.InCooldown("c1", now) {
		t.Fatal("expected cooldown active")
	}
	if stats.InCooldown("c1", now.Add(31*time.Second)) {
		t.Fatal("expected cooldown expired")
	}
}

func TestReloadKeepsChannelsOnInvalidJSON(t *testing.T) {
	dir := t.TempDir()
	file := filepath.Join(dir, "channels.json")
	body := []byte(`{"channels":[{"id":"ch-keep","tenantId":"t1","status":"active","supportedModels":["m-keep"],"weight":1}]}`)
	if err := os.WriteFile(file, body, 0o600); err != nil {
		t.Fatal(err)
	}
	t.Setenv("GATEWAY_REMOTE_CHANNELS_URL", "")
	t.Setenv("GATEWAY_ADMIN_CHANNELS_FILE", file)
	status := configstatus.NewRegistry(nil)
	reg := NewRegistry(nil, nil)
	reg.SetConfigStatus(status)
	if err := reg.reload(); err != nil {
		t.Fatal(err)
	}
	if _, ok := reg.ByID("ch-keep"); !ok {
		t.Fatal("expected channel after valid load")
	}
	if err := os.WriteFile(file, []byte(`{`), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := reg.reload(); err == nil {
		t.Fatal("expected parse error")
	}
	if _, ok := reg.ByID("ch-keep"); !ok {
		t.Fatal("invalid json cleared the last snapshot")
	}
	if channelLastError(t, status) == "" {
		t.Fatal("expected LastError")
	}
}

func TestReloadKeepsChannelsOnRemote404(t *testing.T) {
	var hits atomic.Int32
	good := []byte(`{"channels":[{"id":"ch-keep","tenantId":"t1","status":"active","supportedModels":["m-keep"],"weight":1}]}`)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		if hits.Add(1) == 1 {
			_, _ = w.Write(good)
			return
		}
		w.WriteHeader(http.StatusNotFound)
	}))
	t.Cleanup(srv.Close)
	t.Setenv("GATEWAY_REMOTE_CHANNELS_URL", srv.URL)
	t.Setenv("GATEWAY_ADMIN_CHANNELS_FILE", "")
	status := configstatus.NewRegistry(nil)
	reg := NewRegistry(nil, nil)
	reg.SetConfigStatus(status)
	if err := reg.reload(); err != nil {
		t.Fatal(err)
	}
	err := reg.reload()
	if err == nil || !strings.Contains(err.Error(), "remote 404") {
		t.Fatalf("reload err = %v", err)
	}
	if _, ok := reg.ByID("ch-keep"); !ok {
		t.Fatal("remote 404 cleared the last snapshot")
	}
	if !strings.Contains(channelLastError(t, status), "remote 404") {
		t.Fatalf("LastError = %q", channelLastError(t, status))
	}
}

func TestReloadResynthesizesChannelsWhileRemote404(t *testing.T) {
	dir := t.TempDir()
	file := filepath.Join(dir, "providers.json")
	writeProviderModel(t, file, "model-a")
	t.Setenv("GATEWAY_REMOTE_PROVIDERS_URL", "")
	t.Setenv("GATEWAY_ADMIN_PROVIDERS_FILE", file)

	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	admin := runtimeconfig.New(logger)
	ctx, cancel := context.WithCancel(context.Background())
	admin.Start(ctx)
	cancel()
	if _, ok := admin.ResolveByModel("model-a", ""); !ok {
		t.Fatal("providers loader missed model-a")
	}

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNotFound)
	}))
	t.Cleanup(srv.Close)
	t.Setenv("GATEWAY_REMOTE_CHANNELS_URL", srv.URL)
	t.Setenv("GATEWAY_ADMIN_CHANNELS_FILE", "")

	status := configstatus.NewRegistry(nil)
	reg := NewRegistry(nil, admin)
	reg.SetConfigStatus(status)
	if err := reg.reload(); err != nil {
		t.Fatal(err)
	}
	if len(reg.ListByModel("", "model-a")) == 0 {
		t.Fatal("expected synthesized channel for model-a")
	}

	writeProviderModel(t, file, "model-b")
	ctx, cancel = context.WithCancel(context.Background())
	admin.Start(ctx)
	cancel()
	if _, ok := admin.ResolveByModel("model-b", ""); !ok {
		t.Fatal("providers loader missed model-b")
	}
	if err := reg.reload(); err != nil {
		t.Fatalf("compat reload err = %v", err)
	}
	if len(reg.ListByModel("", "model-a")) != 0 {
		t.Fatal("stale synthesized channel for model-a")
	}
	if len(reg.ListByModel("", "model-b")) == 0 {
		t.Fatal("expected synthesized channel for model-b")
	}
	if got := channelLastError(t, status); got != "" {
		t.Fatalf("LastError = %q", got)
	}
}

func TestReloadSynthesizesChannelsFromRemoteProvidersWhenChannelsEmpty(t *testing.T) {
	const model = "kimi-k2.6"
	providersBody := `{"providers":[{"id":"p-remote","displayName":"Remote","baseUrl":"https://example.test/v1","apiKey":"test-key","enabled":true,"route":"third-party","models":[{"name":"` + model + `","enabled":true}]}]}`
	providersSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(providersBody))
	}))
	t.Cleanup(providersSrv.Close)
	t.Setenv("GATEWAY_REMOTE_PROVIDERS_URL", providersSrv.URL)
	t.Setenv("GATEWAY_ADMIN_PROVIDERS_FILE", "")

	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	admin := runtimeconfig.New(logger)
	ctx, cancel := context.WithCancel(context.Background())
	admin.Start(ctx)
	cancel()
	if _, ok := admin.ResolveByModel(model, ""); !ok {
		t.Fatal("providers loader missed remote model")
	}

	channelsSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"channels":[]}`))
	}))
	t.Cleanup(channelsSrv.Close)
	t.Setenv("GATEWAY_REMOTE_CHANNELS_URL", channelsSrv.URL)
	t.Setenv("GATEWAY_ADMIN_CHANNELS_FILE", "")

	reg := NewRegistry(logger, admin)
	if err := reg.reload(); err != nil {
		t.Fatal(err)
	}
	got := reg.ListByModel("", model)
	if len(got) == 0 {
		t.Fatal("expected synthesized channel for remote provider model")
	}
	if got[0].ID != "legacy-p-remote" {
		t.Fatalf("channel id = %q", got[0].ID)
	}
	if got[0].APIKey != "test-key" {
		t.Fatalf("channel apiKey = %q", got[0].APIKey)
	}
}

func writeProviderModel(t *testing.T, file, model string) {
	t.Helper()
	body := `{"providers":[{"id":"p1","displayName":"P","baseUrl":"https://example.test/v1","apiKey":"k","enabled":true,"route":"third-party","models":[{"name":"` + model + `","enabled":true}]}]}`
	if err := os.WriteFile(file, []byte(body), 0o600); err != nil {
		t.Fatal(err)
	}
}

func channelLastError(t *testing.T, status *configstatus.Registry) string {
	t.Helper()
	for _, item := range status.Snapshot() {
		if item.Domain == configstatus.DomainChannels {
			return item.LastError
		}
	}
	t.Fatal("missing channels domain")
	return ""
}
