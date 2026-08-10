package metering

import (
	"os"
	"regexp"
	"strings"
)

const (
	traceIOFieldMaxChars = 2000
	traceIOMetaMaxBytes  = 8 * 1024
)

var (
	reAPIKeyLike = regexp.MustCompile(`(?i)(api[_-]?key|authorization)\s*[:=]\s*\S.*`)
	reBearer     = regexp.MustCompile(`(?i)bearer\s+\S+`)
	reSKPrefix   = regexp.MustCompile(`\bsk-[A-Za-z0-9]{8,}\b`)
	reEmail      = regexp.MustCompile(`[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}`)
	rePhoneCN    = regexp.MustCompile(`\b1[3-9]\d{9}\b`)
)

// TraceIOCaptureEnabled reads GATEWAY_TRACE_IO_CAPTURE (default off).
func TraceIOCaptureEnabled() bool {
	v := strings.ToLower(strings.TrimSpace(os.Getenv("GATEWAY_TRACE_IO_CAPTURE")))
	return v == "on" || v == "1" || v == "true"
}

// RedactTraceText strips common secrets / PII markers before persisting previews.
func RedactTraceText(raw string) string {
	if raw == "" {
		return ""
	}
	out := reAPIKeyLike.ReplaceAllString(raw, "$1=[REDACTED]")
	out = reBearer.ReplaceAllString(out, "Bearer [REDACTED]")
	out = reSKPrefix.ReplaceAllString(out, "sk-[REDACTED]")
	out = reEmail.ReplaceAllString(out, "[REDACTED_EMAIL]")
	out = rePhoneCN.ReplaceAllString(out, "[REDACTED_PHONE]")
	return out
}

// TruncateTracePreview caps a single preview field and reports truncation.
func TruncateTracePreview(raw string, limit int) (string, bool) {
	if limit <= 0 {
		limit = traceIOFieldMaxChars
	}
	if len(raw) <= limit {
		return raw, false
	}
	return raw[:limit] + "…", true
}

// BuildTraceIOMetadata builds metadata.io when capture is enabled.
// Returns nil when both sides empty or capture disabled.
func BuildTraceIOMetadata(prompt, completion string) map[string]any {
	if !TraceIOCaptureEnabled() {
		return nil
	}
	prompt = RedactTraceText(prompt)
	completion = RedactTraceText(completion)
	if strings.TrimSpace(prompt) == "" && strings.TrimSpace(completion) == "" {
		return nil
	}
	p, pt := TruncateTracePreview(prompt, traceIOFieldMaxChars)
	c, ct := TruncateTracePreview(completion, traceIOFieldMaxChars)
	truncated := pt || ct
	io := map[string]any{
		"prompt_preview":     p,
		"completion_preview": c,
		"truncated":          truncated,
	}
	return io
}

// CapTraceMetadata enforces an 8KB serialized budget for metadata.
// On overflow keeps only stage (+ truncated flag).
func CapTraceMetadata(meta map[string]any) map[string]any {
	if meta == nil {
		return map[string]any{}
	}
	// Cheap size estimate via JSON-ish string lengths
	size := 2
	for k, v := range meta {
		size += len(k) + 8
		switch t := v.(type) {
		case string:
			size += len(t)
		case map[string]any:
			for ik, iv := range t {
				size += len(ik) + 8
				if s, ok := iv.(string); ok {
					size += len(s)
				} else {
					size += 32
				}
			}
		default:
			size += 32
		}
	}
	if size <= traceIOMetaMaxBytes {
		return meta
	}
	out := map[string]any{"truncated": true}
	if stage, ok := meta["stage"].(string); ok && stage != "" {
		out["stage"] = stage
	}
	return out
}
