package metering

import (
	"strings"
	"testing"
)

func TestRedactTraceText(t *testing.T) {
	in := "Authorization: Bearer abc.def Authorization: sk-abcdefghijklmnopqrstuvw call user@example.com 13800138000"
	out := RedactTraceText(in)
	if strings.Contains(out, "sk-abcdefgh") {
		t.Fatalf("sk key not redacted: %s", out)
	}
	if strings.Contains(out, "user@example.com") {
		t.Fatalf("email not redacted: %s", out)
	}
	if strings.Contains(out, "13800138000") {
		t.Fatalf("phone not redacted: %s", out)
	}
	if !strings.Contains(out, "[REDACTED]") && !strings.Contains(out, "[REDACTED_EMAIL]") {
		t.Fatalf("expected redaction markers: %s", out)
	}
}

func TestTruncateTracePreview(t *testing.T) {
	s, truncated := TruncateTracePreview(strings.Repeat("a", 10), 8)
	if !truncated || !strings.HasSuffix(s, "…") || len([]rune(s)) != 9 {
		t.Fatalf("unexpected truncate: %q truncated=%v runes=%d", s, truncated, len([]rune(s)))
	}
}

func TestCapTraceMetadata(t *testing.T) {
	huge := map[string]any{
		"stage": "dr.plan",
		"io": map[string]any{
			"prompt_preview":     strings.Repeat("p", 5000),
			"completion_preview": strings.Repeat("c", 5000),
			"truncated":          true,
		},
		"route": "third-party",
	}
	capped := CapTraceMetadata(huge)
	if capped["stage"] != "dr.plan" {
		t.Fatalf("stage should be kept: %+v", capped)
	}
	if capped["truncated"] != true {
		t.Fatalf("truncated flag expected: %+v", capped)
	}
	if _, ok := capped["io"]; ok {
		t.Fatalf("io should be dropped on overflow: %+v", capped)
	}
}
