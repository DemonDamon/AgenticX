package server

import (
	"context"
	"errors"
	"github.com/agenticx/enterprise/gateway/internal/observability"
	"github.com/agenticx/enterprise/gateway/internal/openai"
	"github.com/agenticx/enterprise/gateway/internal/quota"
	"net/http"
)

func (s *Server) bindChatLease(r *http.Request, receipt *quota.ReservationReceipt) (*http.Request, func()) {
	if receipt == nil || receipt.Lease == nil {
		return r, func() {}
	}
	ctx, cancel := receipt.Lease.Bind(r.Context())
	if errors.Is(context.Cause(ctx), quota.ErrConcurrencyLeaseLost) {
		observability.PhasesFromContext(ctx).SetReason(observability.ReasonConcurrencyLeaseLost)
	}
	return r.WithContext(ctx), cancel
}
func concurrencyLeaseLost(identity requestIdentity) bool {
	lost := identity.quotaReservation != nil && identity.quotaReservation.Lease != nil && identity.quotaReservation.Lease.IsLost()
	if lost {
		// This recorder is shared with the outer middleware even when the
		// bound request is a clone with a separately cancelled context.
		identity.diagnostics.SetReason(observability.ReasonConcurrencyLeaseLost)
	}
	return lost
}
func leaseAwareAPIError(err error) openai.APIError {
	if errors.Is(err, quota.ErrConcurrencyLeaseLost) {
		return openai.APIError{Code: "50302", Message: "请求并发许可失效，请重试。", HTTPStatus: http.StatusServiceUnavailable}
	}
	return openai.Internal(err.Error())
}

func cachedRequestError(r *http.Request, identity requestIdentity) error {
	if concurrencyLeaseLost(identity) {
		if r != nil {
			observability.PhasesFromContext(r.Context()).SetReason(observability.ReasonConcurrencyLeaseLost)
		}
		return quota.ErrConcurrencyLeaseLost
	}
	if r != nil {
		if errors.Is(context.Cause(r.Context()), quota.ErrConcurrencyLeaseLost) {
			observability.PhasesFromContext(r.Context()).SetReason(observability.ReasonConcurrencyLeaseLost)
			return quota.ErrConcurrencyLeaseLost
		}
		return r.Context().Err()
	}
	return nil
}
func (s *Server) refuseCachedRequest(w http.ResponseWriter, r *http.Request, identity requestIdentity) bool {
	if err := cachedRequestError(r, identity); err != nil {
		writeAPIError(w, leaseAwareAPIError(err))
		return true
	}
	return false
}

type leaseCacheStreamWriter struct {
	http.ResponseWriter
	flusher    http.Flusher
	identity   requestIdentity
	request    *http.Request
	err        error
	afterWrite func()
}

func (w *leaseCacheStreamWriter) WriteHeader(code int) {
	if err := cachedRequestError(w.request, w.identity); err != nil {
		w.err = err
		return
	}
	w.ResponseWriter.WriteHeader(code)
}
func (w *leaseCacheStreamWriter) Write(data []byte) (int, error) {
	if w.err != nil {
		return 0, w.err
	}
	if err := cachedRequestError(w.request, w.identity); err != nil {
		w.err = err
		return 0, err
	}
	n, err := w.ResponseWriter.Write(data)
	if n > 0 && w.afterWrite != nil {
		w.afterWrite()
	}
	if err != nil {
		w.err = err
	}
	return n, err
}
func (w *leaseCacheStreamWriter) Flush() {
	if err := cachedRequestError(w.request, w.identity); err != nil {
		w.err = err
		return
	}
	if w.flusher != nil {
		w.flusher.Flush()
	}
}
