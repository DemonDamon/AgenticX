package server

import (
	"net/http"
	"strconv"
	"strings"
	"unicode"

	"github.com/agenticx/enterprise/gateway/internal/audit"
)

const (
	headerTraceID       = "X-AgenticX-Trace-Id"
	headerTraceStep     = "X-AgenticX-Trace-Step"
	headerTraceStage    = "X-AgenticX-Trace-Stage"
	headerSessionID     = "X-AgenticX-Session-Id"
	headerDeploymentID  = "X-AgenticX-Deployment-Id"
	maxTraceStageLen    = 64
	maxCorrelationIDLen = 128
)

func sanitizeCorrelationID(raw string) string {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return ""
	}
	if len(raw) > maxCorrelationIDLen {
		raw = raw[:maxCorrelationIDLen]
	}
	return raw
}

func enrichTraceFromRequest(identity requestIdentity, r *http.Request) requestIdentity {
	if r == nil {
		return identity
	}
	identity.TraceID = strings.TrimSpace(r.Header.Get(headerTraceID))
	identity.TraceStep = parseTraceStep(r.Header.Get(headerTraceStep))
	identity.TraceStage = sanitizeStage(r.Header.Get(headerTraceStage))
	identity.DeploymentID = sanitizeCorrelationID(r.Header.Get(headerDeploymentID))
	if strings.TrimSpace(identity.SessionID) == "" {
		identity.SessionID = sanitizeCorrelationID(r.Header.Get(headerSessionID))
	}
	return identity
}

func fillAuditCorrelation(ev audit.Event, id requestIdentity) audit.Event {
	if strings.TrimSpace(ev.SessionID) == "" {
		ev.SessionID = strings.TrimSpace(id.SessionID)
	}
	if strings.TrimSpace(ev.TraceID) == "" {
		ev.TraceID = strings.TrimSpace(id.TraceID)
	}
	if strings.TrimSpace(ev.DeploymentID) == "" {
		ev.DeploymentID = strings.TrimSpace(id.DeploymentID)
	}
	if strings.TrimSpace(ev.TenantID) == "" {
		ev.TenantID = strings.TrimSpace(id.TenantID)
	}
	return ev
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
