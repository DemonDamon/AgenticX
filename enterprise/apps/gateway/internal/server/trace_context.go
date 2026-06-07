package server

import (
	"net/http"
	"strconv"
	"strings"
)

const (
	headerTraceID   = "X-AgenticX-Trace-Id"
	headerTraceStep = "X-AgenticX-Trace-Step"
)

func enrichTraceFromRequest(identity requestIdentity, r *http.Request) requestIdentity {
	if r == nil {
		return identity
	}
	identity.TraceID = strings.TrimSpace(r.Header.Get(headerTraceID))
	identity.TraceStep = parseTraceStep(r.Header.Get(headerTraceStep))
	return identity
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
