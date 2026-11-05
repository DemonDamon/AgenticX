package observability

import (
	"context"
	"log/slog"
	"net/http"
	"os"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/go-chi/chi/v5/middleware"
)

// Phase is a closed set; request data must never become an observation key.
type Phase uint8

const (
	AdmissionWait Phase = iota
	UpstreamStart
	ResponseHeaders
	FirstBodyByte
	FirstContent
	phaseCount
)

var phaseLabels = [...]string{"admission_wait", "upstream_start", "response_headers", "first_body_byte", "first_content"}

// TerminalReason accepts only the values canonicalReason explicitly permits.
type TerminalReason string

const (
	ReasonCompleted       TerminalReason = "completed"
	ReasonRejected        TerminalReason = "rejected"
	ReasonAuth            TerminalReason = "auth_error"
	ReasonForbidden       TerminalReason = "forbidden"
	ReasonQuotaDenied     TerminalReason = "quota_denied"
	ReasonRateLimited     TerminalReason = "rate_limited"
	ReasonPolicyBlocked   TerminalReason = "policy_blocked"
	ReasonHeaderTimeout   TerminalReason = "header_timeout"
	ReasonIdleTimeout     TerminalReason = "idle_timeout"
	ReasonIncomplete      TerminalReason = "incomplete_stream"
	ReasonBufferExceeded  TerminalReason = "buffer_exceeded"
	ReasonClientCancelled TerminalReason = "client_cancelled"
	ReasonRequestTimeout  TerminalReason = "request_timeout"
	ReasonDownstreamError TerminalReason = "downstream_error"
	ReasonUpstreamError   TerminalReason = "upstream_error"
	ReasonInternalError   TerminalReason = "internal_error"
	ReasonOther           TerminalReason = "other"
)

func canonicalReason(reason TerminalReason) TerminalReason {
	switch reason {
	case ReasonCompleted, ReasonRejected, ReasonAuth, ReasonForbidden, ReasonQuotaDenied,
		ReasonRateLimited, ReasonPolicyBlocked, ReasonHeaderTimeout, ReasonIdleTimeout,
		ReasonIncomplete, ReasonBufferExceeded, ReasonClientCancelled, ReasonRequestTimeout,
		ReasonDownstreamError, ReasonUpstreamError, ReasonInternalError:
		return reason
	default:
		return ReasonOther
	}
}

const maxPhaseDuration = 24 * time.Hour

func boundedDuration(d time.Duration) time.Duration {
	if d < 0 {
		return 0
	}
	if d > maxPhaseDuration {
		return maxPhaseDuration
	}
	return d
}

// PhaseSnapshot contains fixed numeric fields only. -1 means not observed.
// Admission is a duration; other phases are offsets from request entry.
type PhaseSnapshot struct {
	AdmissionWaitMS   int64          `json:"admission_wait_ms"`
	UpstreamStartMS   int64          `json:"upstream_start_ms"`
	ResponseHeadersMS int64          `json:"response_headers_ms"`
	FirstBodyByteMS   int64          `json:"first_body_byte_ms"`
	FirstContentMS    int64          `json:"first_content_ms"`
	TotalMS           int64          `json:"total_ms"`
	Reason            TerminalReason `json:"reason"`
	seen              uint8
}

// TraceMetadata fits the existing reporter's bounded scalar metadata contract.
func (s PhaseSnapshot) TraceMetadata() map[string]any {
	return map[string]any{
		"admission_wait_ms": s.AdmissionWaitMS, "upstream_start_ms": s.UpstreamStartMS,
		"response_headers_ms": s.ResponseHeadersMS, "first_body_byte_ms": s.FirstBodyByteMS,
		"first_content_ms": s.FirstContentMS, "total_ms": s.TotalMS,
		"reason": string(canonicalReason(s.Reason)),
	}
}

func (s PhaseSnapshot) phaseMS() [phaseCount]int64 {
	return [phaseCount]int64{s.AdmissionWaitMS, s.UpstreamStartMS, s.ResponseHeadersMS, s.FirstBodyByteMS, s.FirstContentMS}
}

// RequestPhases retains at most one value per fixed phase and one terminal reason.
// It never stores a request, arbitrary attributes, an error, or a stream chunk.
type RequestPhases struct {
	mu       sync.Mutex
	started  time.Time
	elapsed  [phaseCount]time.Duration
	seen     uint8
	reason   TerminalReason
	finished bool
	snapshot PhaseSnapshot
	logger   *slog.Logger
	metrics  *Registry
}

type phasesContextKey struct{}

func PhasesFromContext(ctx context.Context) *RequestPhases {
	phases, _ := ctx.Value(phasesContextKey{}).(*RequestPhases)
	return phases
}

func (p *RequestPhases) Mark(phase Phase) {
	if p != nil {
		p.MarkAt(phase, time.Now())
	}
}

func (p *RequestPhases) MarkAt(phase Phase, at time.Time) {
	if p == nil || phase >= phaseCount || phase == AdmissionWait {
		return
	}
	p.observe(phase, at.Sub(p.started))
}

func (p *RequestPhases) ObserveAdmission(d time.Duration) {
	if p != nil {
		p.observe(AdmissionWait, d)
	}
}

func (p *RequestPhases) observe(phase Phase, d time.Duration) {
	p.mu.Lock()
	defer p.mu.Unlock()
	mask := uint8(1) << phase
	if p.finished || p.seen&mask != 0 {
		return
	}
	p.elapsed[phase] = boundedDuration(d)
	p.seen |= mask
}

func (p *RequestPhases) SetReason(reason TerminalReason) {
	if p == nil {
		return
	}
	p.mu.Lock()
	defer p.mu.Unlock()
	if !p.finished {
		p.reason = canonicalReason(reason)
	}
}

// SetReasonIfUnset preserves a more precise producer decision (for example a
// downstream callback failure) when a caller only knows a generic stream error.
func (p *RequestPhases) SetReasonIfUnset(reason TerminalReason) {
	if p == nil {
		return
	}
	p.mu.Lock()
	defer p.mu.Unlock()
	if !p.finished && p.reason == "" {
		p.reason = canonicalReason(reason)
	}
}

func (p *RequestPhases) snapshotLocked() PhaseSnapshot {
	values := [phaseCount]int64{-1, -1, -1, -1, -1}
	for phase := Phase(0); phase < phaseCount; phase++ {
		if p.seen&(uint8(1)<<phase) != 0 {
			values[phase] = p.elapsed[phase].Milliseconds()
		}
	}
	return PhaseSnapshot{
		AdmissionWaitMS: values[AdmissionWait], UpstreamStartMS: values[UpstreamStart],
		ResponseHeadersMS: values[ResponseHeaders], FirstBodyByteMS: values[FirstBodyByte],
		FirstContentMS: values[FirstContent], TotalMS: boundedDuration(time.Since(p.started)).Milliseconds(),
		Reason: canonicalReason(p.reason), seen: p.seen,
	}
}

func (p *RequestPhases) Snapshot() PhaseSnapshot {
	if p == nil {
		return PhaseSnapshot{AdmissionWaitMS: -1, UpstreamStartMS: -1, ResponseHeadersMS: -1, FirstBodyByteMS: -1, FirstContentMS: -1, Reason: ReasonOther}
	}
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.finished {
		return p.snapshot
	}
	return p.snapshotLocked()
}

// Finish emits once per sampled request. Only fixed fields and allowlisted
// reasons cross this boundary; even a caller-supplied unknown reason is erased.
func (p *RequestPhases) Finish(ctx context.Context, fallback TerminalReason) {
	if p == nil {
		return
	}
	p.mu.Lock()
	if p.finished {
		p.mu.Unlock()
		return
	}
	if p.reason == "" {
		p.reason = canonicalReason(fallback)
	}
	p.snapshot = p.snapshotLocked()
	p.finished = true
	snapshot := p.snapshot
	p.mu.Unlock()
	p.metrics.ObserveRequestPhases(snapshot)
	if p.logger != nil {
		p.logger.LogAttrs(ctx, slog.LevelInfo, "gateway.request_phases",
			slog.String("event", "gateway.request_phases"), slog.String("reason", string(snapshot.Reason)),
			slog.Int64("admission_wait_ms", snapshot.AdmissionWaitMS), slog.Int64("upstream_start_ms", snapshot.UpstreamStartMS),
			slog.Int64("response_headers_ms", snapshot.ResponseHeadersMS), slog.Int64("first_body_byte_ms", snapshot.FirstBodyByteMS),
			slog.Int64("first_content_ms", snapshot.FirstContentMS), slog.Int64("total_ms", snapshot.TotalMS))
	}
}

// PhaseSampler has constant memory: disabled is the default, N samples 1/N.
// There is no request-key cache, per-token collection, or background queue.
type PhaseSampler struct {
	every    uint64
	sequence atomic.Uint64
	logger   *slog.Logger
	metrics  *Registry
}

func NewPhaseSampler(every uint64, logger *slog.Logger, metrics *Registry) *PhaseSampler {
	if every > 1_000_000 {
		every = 0
	}
	return &PhaseSampler{every: every, logger: logger, metrics: metrics}
}

func NewPhaseSamplerFromEnv(logger *slog.Logger, metrics *Registry) *PhaseSampler {
	every, _ := strconv.ParseUint(strings.TrimSpace(os.Getenv("GATEWAY_REQUEST_DIAGNOSTICS_SAMPLE_EVERY")), 10, 64)
	return NewPhaseSampler(every, logger, metrics)
}

func (s *PhaseSampler) Start(ctx context.Context) (context.Context, *RequestPhases) {
	if s == nil || s.every == 0 || (s.sequence.Add(1)-1)%s.every != 0 {
		return ctx, nil
	}
	phases := &RequestPhases{started: time.Now(), logger: s.logger, metrics: s.metrics}
	return context.WithValue(ctx, phasesContextKey{}, phases), phases
}

func diagnosticHTTPReason(ctx context.Context, status int) TerminalReason {
	switch ctx.Err() {
	case context.Canceled:
		return ReasonClientCancelled
	case context.DeadlineExceeded:
		return ReasonRequestTimeout
	}
	switch {
	case status >= 500:
		return ReasonInternalError
	case status == http.StatusTooManyRequests:
		return ReasonRateLimited
	case status == http.StatusUnauthorized:
		return ReasonAuth
	case status == http.StatusForbidden:
		return ReasonForbidden
	case status >= 400:
		return ReasonRejected
	default:
		return ReasonCompleted
	}
}

func (s *PhaseSampler) HTTPMiddleware() func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			// Nested routers share the owning middleware's one terminal record.
			if PhasesFromContext(r.Context()) != nil {
				next.ServeHTTP(w, r)
				return
			}
			ctx, phases := s.Start(r.Context())
			if phases == nil {
				next.ServeHTTP(w, r)
				return
			}
			ww := middleware.NewWrapResponseWriter(w, r.ProtoMajor)
			defer func() {
				if recovered := recover(); recovered != nil {
					phases.SetReason(ReasonInternalError)
					phases.Finish(ctx, ReasonInternalError)
					panic(recovered)
				}
				if ctx.Err() != nil {
					// Cancellation may happen after the upstream has completed.
					phases.SetReason(diagnosticHTTPReason(ctx, ww.Status()))
				}
				phases.Finish(ctx, diagnosticHTTPReason(ctx, ww.Status()))
			}()
			next.ServeHTTP(ww, r.WithContext(ctx))
		})
	}
}
