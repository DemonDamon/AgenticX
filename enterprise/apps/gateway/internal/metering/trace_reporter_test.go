package metering

import "testing"

func TestTraceSpanRecordCarriesDurationAndError(t *testing.T) {
	rec := TraceSpanRecord{
		ID:           "trace_1",
		TenantID:     "tenant-a",
		TraceID:      "01JZTRACEID000000000000001",
		StepNo:       1,
		StepKind:     "model",
		Status:       "error",
		DurationMS:   1234,
		ErrorMessage: "upstream 500",
		Metadata: map[string]any{
			"stage": "chat.answer",
		},
	}
	if rec.DurationMS <= 0 {
		t.Fatal("DurationMS must be > 0")
	}
	if rec.ErrorMessage == "" {
		t.Fatal("ErrorMessage required for error spans")
	}
	if rec.Status != "error" {
		t.Fatalf("status=%s", rec.Status)
	}
	if rec.Metadata["stage"] != "chat.answer" {
		t.Fatalf("metadata=%v", rec.Metadata)
	}
}
