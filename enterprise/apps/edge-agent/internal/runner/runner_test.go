package runner

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"testing"
	"time"

	"github.com/agenticx/enterprise/edge-agent/internal/sandbox"
	"github.com/agenticx/enterprise/edge-agent/internal/trace"
)

type mockGateway struct {
	usages []trace.Usage
	calls  int
}

func (m *mockGateway) Complete(_ context.Context, traceID string, stepNo int, model, prompt string) (trace.Usage, error) {
	if traceID == "" || stepNo <= 0 || model == "" || prompt == "" {
		return trace.Usage{}, errors.New("invalid model call")
	}
	if m.calls >= len(m.usages) {
		return trace.Usage{}, errors.New("unexpected model call")
	}
	usage := m.usages[m.calls]
	m.calls++
	return usage, nil
}

func TestTwoStepModelTraceTotals(t *testing.T) {
	dir := t.TempDir()
	store, err := trace.NewStore(filepath.Join(dir, "traces.jsonl"))
	if err != nil {
		t.Fatal(err)
	}
	gw := &mockGateway{usages: []trace.Usage{
		{InputTokens: 10, OutputTokens: 5, TotalTokens: 15, CostUSD: 0.001},
		{InputTokens: 20, OutputTokens: 8, TotalTokens: 28, CostUSD: 0.002},
	}}
	r := New(gw, store, sandbox.DefaultConfig())
	result, err := r.Run(context.Background(), RunRequest{
		Steps: []Step{
			{StepNo: 1, Kind: trace.StepKindModel, Model: "gpt-4o-mini", Prompt: "step1"},
			{StepNo: 2, Kind: trace.StepKindModel, Model: "gpt-4o-mini", Prompt: "step2"},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Trace.Spans) != 2 {
		t.Fatalf("expected 2 spans, got %d", len(result.Trace.Spans))
	}
	if result.Trace.TotalUsage.InputTokens != 30 {
		t.Fatalf("input tokens mismatch: %d", result.Trace.TotalUsage.InputTokens)
	}
	if result.Trace.TotalUsage.OutputTokens != 13 {
		t.Fatalf("output tokens mismatch: %d", result.Trace.TotalUsage.OutputTokens)
	}
	if result.Trace.TotalUsage.TotalTokens != 43 {
		t.Fatalf("total tokens mismatch: %d", result.Trace.TotalUsage.TotalTokens)
	}
}

func TestCommandTimeoutMarksTraceFailed(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("sleep differs on windows")
	}
	dir := t.TempDir()
	store, err := trace.NewStore(filepath.Join(dir, "traces.jsonl"))
	if err != nil {
		t.Fatal(err)
	}
	r := New(&mockGateway{}, store, sandbox.Config{CommandTimeout: 200 * time.Millisecond, MaxOutputBytes: 4096})
	result, err := r.Run(context.Background(), RunRequest{
		Steps: []Step{{StepNo: 1, Kind: trace.StepKindExec, Command: []string{"sleep", "5"}}},
	})
	if err != nil {
		t.Fatal(err)
	}
	if result.Trace.Spans[0].Status != trace.StatusTimeout {
		t.Fatalf("expected timeout status, got %s", result.Trace.Spans[0].Status)
	}
}

func TestPathEscapeRejected(t *testing.T) {
	dir := t.TempDir()
	store, err := trace.NewStore(filepath.Join(dir, "traces.jsonl"))
	if err != nil {
		t.Fatal(err)
	}
	r := New(&mockGateway{}, store, sandbox.DefaultConfig())
	result, err := r.Run(context.Background(), RunRequest{
		Steps: []Step{{StepNo: 1, Kind: trace.StepKindWrite, RelPath: "../outside.txt", Content: "x"}},
	})
	if err != nil {
		t.Fatal(err)
	}
	if result.Trace.Spans[0].Status != trace.StatusFailed {
		t.Fatalf("expected failed status, got %s", result.Trace.Spans[0].Status)
	}
	if !errors.Is(errors.New(result.Trace.Spans[0].ErrorMessage), sandbox.ErrPathEscape) {
		if !contains(result.Trace.Spans[0].ErrorMessage, "outside workspace") {
			t.Fatalf("unexpected error: %s", result.Trace.Spans[0].ErrorMessage)
		}
	}
}

func contains(s, sub string) bool {
	return len(s) >= len(sub) && (s == sub || len(sub) == 0 || indexSubstring(s, sub))
}

func indexSubstring(s, sub string) bool {
	for i := 0; i+len(sub) <= len(s); i++ {
		if s[i:i+len(sub)] == sub {
			return true
		}
	}
	return false
}

func TestTracePersistedToStore(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "traces.jsonl")
	store, err := trace.NewStore(path)
	if err != nil {
		t.Fatal(err)
	}
	gw := &mockGateway{usages: []trace.Usage{{InputTokens: 1, OutputTokens: 2, TotalTokens: 3}}}
	r := New(gw, store, sandbox.DefaultConfig())
	result, err := r.Run(context.Background(), RunRequest{
		Steps: []Step{{StepNo: 1, Kind: trace.StepKindModel, Model: "m", Prompt: "p"}},
	})
	if err != nil {
		t.Fatal(err)
	}
	got, ok, err := store.GetTrace(result.Trace.TraceID)
	if err != nil || !ok {
		t.Fatalf("trace not found: ok=%v err=%v", ok, err)
	}
	if got.TotalUsage.TotalTokens != 3 {
		t.Fatalf("stored total tokens=%d", got.TotalUsage.TotalTokens)
	}
	if _, err := os.Stat(path); err != nil {
		t.Fatal(err)
	}
}
