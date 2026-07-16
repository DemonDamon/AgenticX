package audit

import (
	"testing"
	"time"
)

func TestFileWriter_ChecksumIncludesCrossBorderFields(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	w := NewFileWriter(dir)
	ev1 := &Event{
		ID:            "audit-1",
		TenantID:      "tenant-1",
		EventTime:     time.Now().UTC().Format(time.RFC3339),
		EventType:     "chat_call",
		ClientType:    "web-portal",
		Route:         "third-party",
		SrcRegion:     "cn",
		DstRegion:     "us",
		CrossBorder:   true,
		ResidencyRule: "cross_border:allow",
	}
	if err := w.Write(ev1); err != nil {
		t.Fatalf("write: %v", err)
	}
	ev2 := &Event{
		ID:         "audit-2",
		TenantID:   "tenant-1",
		EventTime:  time.Now().UTC().Format(time.RFC3339),
		EventType:  "chat_call",
		ClientType: "web-portal",
		Route:      "local",
	}
	if err := w.Write(ev2); err != nil {
		t.Fatalf("write second: %v", err)
	}
	if ev2.PrevChecksum != ev1.Checksum {
		t.Fatalf("chain broken: prev=%s want=%s", ev2.PrevChecksum, ev1.Checksum)
	}
	if ev1.Checksum == "" || ev2.Checksum == "" {
		t.Fatal("expected checksums set")
	}
}
