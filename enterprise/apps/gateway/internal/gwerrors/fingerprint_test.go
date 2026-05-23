package gwerrors

import "testing"

func TestComputeFingerprintStable(t *testing.T) {
	a := ComputeFingerprint(401, "invalid_api_key", "Invalid API key req_id=abc-12345")
	b := ComputeFingerprint(401, "invalid_api_key", "Invalid API key req_id=xyz-67890")
	if a != b {
		t.Fatalf("expected stable fingerprint, got %q vs %q", a, b)
	}
}

func TestStoreRecordAndList(t *testing.T) {
	store := NewStore()
	store.RecordError("tenant-a", "req-1", "ch-1", 401, "invalid_api_key", "bad key")
	store.RecordError("tenant-a", "req-2", "ch-1", 401, "invalid_api_key", "bad key")
	items := store.List("tenant-a", 10)
	if len(items) != 1 || items[0].Count != 2 {
		t.Fatalf("unexpected list: %+v", items)
	}
}

func TestParseUpstreamError(t *testing.T) {
	body := []byte(`{"error":{"type":"rate_limit_exceeded","message":"Too many requests id=99999"}}`)
	typ, msg := ParseUpstreamError(429, body)
	if typ != "rate_limit_exceeded" {
		t.Fatalf("type=%q", typ)
	}
	if msg == "" {
		t.Fatal("empty message")
	}
}
