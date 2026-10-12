package connectorstore

import (
	"strings"
	"testing"
	"time"
)

func TestEncodeULIDZero(t *testing.T) {
	var raw [16]byte
	if got := encodeULID(raw); got != "00000000000000000000000000" {
		t.Fatalf("zero ULID = %s", got)
	}
}

func TestNewServerIDIsCrockfordULID(t *testing.T) {
	before := time.Now().Add(-2 * time.Second).UnixMilli()
	id := newServerID()
	after := time.Now().Add(2 * time.Second).UnixMilli()
	if len(id) != 26 {
		t.Fatalf("length = %d, id = %s", len(id), id)
	}
	for _, r := range id {
		if !strings.ContainsRune(crockfordEncoding, r) {
			t.Fatalf("id %s contains %q, which is not Crockford base32", id, r)
		}
	}
	ts := decodeULIDTime(id)
	if ts < uint64(before) || ts > uint64(after) {
		t.Fatalf("timestamp %d outside [%d, %d] for %s", ts, before, after, id)
	}
}

func decodeULIDTime(id string) uint64 {
	var ts uint64
	for i := 0; i < 10; i++ {
		ts = ts*32 + uint64(strings.IndexByte(crockfordEncoding, id[i]))
	}
	return ts
}
