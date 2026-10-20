package server

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/go-chi/chi/v5/middleware"
)

// requestTimeout cancels work at the deadline. A 504 is only written before
// the response starts; an SSE handler must finish its already-started stream.
func requestTimeout(timeout time.Duration) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			ctx, cancel := context.WithTimeout(r.Context(), timeout)
			defer cancel()
			ww := middleware.NewWrapResponseWriter(w, r.ProtoMajor)
			next.ServeHTTP(ww, r.WithContext(ctx))
			if errors.Is(ctx.Err(), context.DeadlineExceeded) && ww.Status() == 0 {
				ww.WriteHeader(http.StatusGatewayTimeout)
			}
		})
	}
}

// requestTimeoutFromEnv reads GATEWAY_REQUEST_TIMEOUT (Go duration, e.g. "10m").
// Empty, unparsable, or non-positive values fall back to 10 minutes.
// Only a parse failure is logged.
func requestTimeoutFromEnv(logger *slog.Logger) time.Duration {
	const fallback = 10 * time.Minute
	raw := strings.TrimSpace(os.Getenv("GATEWAY_REQUEST_TIMEOUT"))
	if raw == "" {
		return fallback
	}
	d, err := time.ParseDuration(raw)
	if err != nil {
		if logger != nil {
			logger.Warn("invalid GATEWAY_REQUEST_TIMEOUT, using 10m", "value", raw, "error", err)
		}
		return fallback
	}
	if d <= 0 {
		return fallback
	}
	return d
}
