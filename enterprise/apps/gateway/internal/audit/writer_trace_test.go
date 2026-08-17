package audit

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestEventTraceIDOmitEmptyPreservesLegacyChecksumPayload(t *testing.T) {
	dir := t.TempDir()
	w := NewFileWriter(dir)

	without := &Event{
		ID:         "audit_1",
		TenantID:   "tenant_1",
		EventTime:  "2026-08-10T00:00:00Z",
		EventType:  "chat_call",
		ClientType: "web-portal",
		Route:      "direct",
	}
	if err := w.Write(without); err != nil {
		t.Fatalf("write without TraceID: %v", err)
	}
	if strings.Contains(without.ChecksumPayload, `"trace_id"`) {
		t.Fatalf("ChecksumPayload must omit empty trace_id, got %s", without.ChecksumPayload)
	}

	with := &Event{
		ID:         "audit_2",
		TenantID:   "tenant_1",
		EventTime:  "2026-08-10T00:00:01Z",
		EventType:  "chat_call",
		ClientType: "web-portal",
		Route:      "direct",
		TraceID:    "01JABCDEFGHJKMNPQRSTVWXYZA",
	}
	if err := w.Write(with); err != nil {
		t.Fatalf("write with TraceID: %v", err)
	}
	if !strings.Contains(with.ChecksumPayload, `"trace_id"`) {
		t.Fatalf("ChecksumPayload should include non-empty trace_id, got %s", with.ChecksumPayload)
	}

	// Ensure the written JSONL line also omits empty TraceID.
	raw, err := os.ReadFile(filepath.Join(dir, "audit-20260810.jsonl"))
	if err != nil {
		// date is UTC "now" — just find any audit-*.jsonl
		entries, _ := os.ReadDir(dir)
		if len(entries) == 0 {
			t.Fatalf("no audit file written: %v", err)
		}
		raw, err = os.ReadFile(filepath.Join(dir, entries[0].Name()))
		if err != nil {
			t.Fatalf("read audit file: %v", err)
		}
	}
	lines := strings.Split(strings.TrimSpace(string(raw)), "\n")
	if len(lines) < 2 {
		t.Fatalf("expected 2 jsonl lines, got %d", len(lines))
	}
	var first map[string]any
	if err := json.Unmarshal([]byte(lines[0]), &first); err != nil {
		t.Fatalf("unmarshal first line: %v", err)
	}
	if _, ok := first["trace_id"]; ok {
		t.Fatalf("first event JSON must omit empty trace_id, got %#v", first["trace_id"])
	}
}
