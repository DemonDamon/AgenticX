package audit

import (
	"encoding/hex"
	"encoding/json"
	"testing"
	"time"

	"golang.org/x/crypto/blake2b"
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

func TestFileWriter_V2StoresExactChecksumPayload(t *testing.T) {
	dir := t.TempDir()
	w := NewFileWriter(dir)
	ev := &Event{
		ID:           "audit-fixture",
		TenantID:     "tenant-fixture",
		EventTime:    "2026-07-16T10:00:00Z",
		EventType:    "chat_call",
		ClientType:   "web-portal",
		Route:        "third-party",
		InputTokens:  5,
		OutputTokens: 7,
		TotalTokens:  12,
	}
	if err := w.Write(ev); err != nil {
		t.Fatalf("write: %v", err)
	}
	if ev.ChecksumVersion != checksumVersionV2 {
		t.Fatalf("checksum version = %q, want %q", ev.ChecksumVersion, checksumVersionV2)
	}
	var payload Event
	if err := json.Unmarshal([]byte(ev.ChecksumPayload), &payload); err != nil {
		t.Fatalf("decode payload: %v", err)
	}
	if payload.Checksum != "" {
		t.Fatalf("payload checksum = %q, want empty", payload.Checksum)
	}
	sum := blake2b.Sum512([]byte(ev.PrevChecksum + "|" + ev.ChecksumPayload))
	if got := hex.EncodeToString(sum[:])[:64]; got != ev.Checksum {
		t.Fatalf("checksum = %s, recomputed = %s", ev.Checksum, got)
	}
	const crossLanguageFixture = "ce374a326a6aa72fcedc52bc5818851a4ecc494967b751830bd2d91da5c15e9c"
	if ev.Checksum != crossLanguageFixture {
		t.Fatalf("checksum = %s, fixture = %s", ev.Checksum, crossLanguageFixture)
	}
}
