package trace_test

import (
	"path/filepath"
	"testing"

	"github.com/agenticx/enterprise/edge-agent/internal/trace"
)

func TestStoreAppendAndGetTrace(t *testing.T) {
	dir := t.TempDir()
	store, err := trace.NewStore(filepath.Join(dir, "traces.jsonl"))
	if err != nil {
		t.Fatal(err)
	}
	span := trace.Span{
		ID:       "span_a",
		TraceID:  "trace_abc",
		StepNo:   1,
		StepKind: trace.StepKindModel,
		Status:   trace.StatusOK,
		Usage:    trace.Usage{InputTokens: 3, OutputTokens: 2, TotalTokens: 5},
	}
	if err := store.AppendSpan(span); err != nil {
		t.Fatal(err)
	}
	got, ok, err := store.GetTrace("trace_abc")
	if err != nil || !ok {
		t.Fatalf("get trace failed ok=%v err=%v", ok, err)
	}
	if got.TotalUsage.TotalTokens != 5 {
		t.Fatalf("total tokens=%d", got.TotalUsage.TotalTokens)
	}
}
