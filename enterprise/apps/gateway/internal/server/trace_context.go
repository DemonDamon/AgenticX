package server

import (
	"crypto/rand"
	"encoding/hex"
	"net/http"
	"strconv"
	"strings"
	"time"
	"unicode"
)

const (
	headerTraceID    = "X-AgenticX-Trace-Id"
	headerTraceStep  = "X-AgenticX-Trace-Step"
	headerTraceStage = "X-AgenticX-Trace-Stage"
	headerTurnID     = "X-AgenticX-Turn-Id"
	maxTraceStageLen = 64
)

func enrichTraceFromRequest(identity requestIdentity, r *http.Request) requestIdentity {
	if r == nil {
		return identity
	}
	identity.TraceID = normalizeCorrelationID(r.Header.Get(headerTraceID))
	identity.TurnID = normalizeCorrelationID(r.Header.Get(headerTurnID))
	if identity.TurnID == "" {
		identity.TurnID = identity.TraceID
	}
	if identity.TurnID == "" {
		// Legacy clients may provide neither header. Give this HTTP request one
		// non-reusable turn id so a single already-admitted model call can own a
		// first crossing, without granting grace to a later request.
		identity.TurnID = newRequestTurnID()
	}
	identity.TraceStep = parseTraceStep(r.Header.Get(headerTraceStep))
	identity.TraceStage = sanitizeStage(r.Header.Get(headerTraceStage))
	return identity
}

func normalizeCorrelationID(raw string) string {
	raw = strings.TrimSpace(raw)
	if len(raw) == 0 || len(raw) > 128 {
		return ""
	}
	for _, r := range raw {
		if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') ||
			(r >= '0' && r <= '9') || r == '.' || r == '_' || r == '-' || r == ':' {
			continue
		}
		return ""
	}
	return raw
}

func newRequestTurnID() string {
	buf := make([]byte, 16)
	if _, err := rand.Read(buf); err == nil {
		return "req-" + hex.EncodeToString(buf)
	}
	return "req-" + strconv.FormatInt(time.Now().UnixNano(), 10)
}

func parseTraceStep(raw string) int {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return 0
	}
	n, err := strconv.Atoi(raw)
	if err != nil || n <= 0 {
		return 0
	}
	return n
}

// sanitizeStage keeps only [a-z0-9._-], truncates to 64 chars.
// Any other character causes the whole value to be discarded.
func sanitizeStage(raw string) string {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return ""
	}
	for _, r := range raw {
		if unicode.IsLetter(r) {
			if r < 'a' || r > 'z' {
				// allow A-Z by lowercasing later; reject non a-zA-Z here via fold
				if r < 'A' || r > 'Z' {
					return ""
				}
			}
			continue
		}
		if unicode.IsDigit(r) || r == '.' || r == '_' || r == '-' {
			continue
		}
		return ""
	}
	out := strings.ToLower(raw)
	if len(out) > maxTraceStageLen {
		out = out[:maxTraceStageLen]
	}
	return out
}
