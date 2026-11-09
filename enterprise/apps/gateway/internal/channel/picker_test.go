package channel

import (
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
