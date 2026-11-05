package server

import (
	"context"
	"errors"

	"github.com/agenticx/enterprise/gateway/internal/adaptor"
	"github.com/agenticx/enterprise/gateway/internal/observability"
	"github.com/agenticx/enterprise/gateway/internal/openai"
	"github.com/agenticx/enterprise/gateway/internal/streamio"
)

// diagnosticStreamReason reads typed evidence only. Never inspect or log the
// error message: it may contain credentials, request URLs or generated content.
func diagnosticStreamReason(err error) observability.TerminalReason {
	switch {
	case err == nil:
		return observability.ReasonCompleted
	case errors.Is(err, context.Canceled):
		return observability.ReasonClientCancelled
	case errors.Is(err, context.DeadlineExceeded):
		return observability.ReasonRequestTimeout
	case errors.Is(err, streamio.ErrHeaderTimeout):
		return observability.ReasonHeaderTimeout
	case errors.Is(err, streamio.ErrIdleTimeout):
		return observability.ReasonIdleTimeout
	case errors.Is(err, streamio.ErrBufferExceeded):
		return observability.ReasonBufferExceeded
	case errors.Is(err, openai.ErrIncompleteStream):
		return observability.ReasonIncomplete
	}
	var upstream *adaptor.UpstreamError
	if errors.As(err, &upstream) {
		switch upstream.StatusCode {
		case 401:
			return observability.ReasonAuth
		case 403:
			return observability.ReasonForbidden
		case 429:
			return observability.ReasonRateLimited
		}
	}
	return observability.ReasonUpstreamError
}

// Producer success is not handler completion: auditing and final frames remain.
func recordStreamDiagnostic(ctx context.Context, err error, policyBlocked bool) {
	phases := observability.PhasesFromContext(ctx)
	if phases == nil {
		return
	}
	if ctx.Err() != nil {
		phases.SetReason(diagnosticStreamReason(ctx.Err()))
	} else if policyBlocked {
		phases.SetReason(observability.ReasonPolicyBlocked)
	} else if err != nil {
		// A producer may already know this was a downstream callback error.
		phases.SetReasonIfUnset(diagnosticStreamReason(err))
	}
}

// recordDiagnosticFailure observes handler-tail failures without changing their
// existing response, return or settlement behavior. The error is never retained.
func recordDiagnosticFailure(ctx context.Context, err error, reason observability.TerminalReason) {
	if err != nil {
		observability.PhasesFromContext(ctx).SetReason(reason)
	}
}
