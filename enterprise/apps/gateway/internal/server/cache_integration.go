package server

import (
	"errors"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/agenticx/enterprise/gateway/internal/audit"
	"github.com/agenticx/enterprise/gateway/internal/cache"
	"github.com/agenticx/enterprise/gateway/internal/inbound"
	"github.com/agenticx/enterprise/gateway/internal/metering"
	"github.com/agenticx/enterprise/gateway/internal/observability"
	"github.com/agenticx/enterprise/gateway/internal/openai"
	"github.com/agenticx/enterprise/gateway/internal/outbound"
	"github.com/agenticx/enterprise/gateway/internal/quota"
	"github.com/agenticx/enterprise/gateway/internal/routing"
)

// spanMeta carries per-call observability fields for agent_token_traces.
type spanMeta struct {
	DurationMS     int
	Status         string // "" → "ok"
	ErrorMessage   string
	Stage          string
	PromptText     string // Phase B optional I/O
	CompletionText string
}

type cacheServeContext struct {
	w                    http.ResponseWriter
	r                    *http.Request
	req                  openai.ChatCompletionRequest
	identity             requestIdentity
	decision             routing.Decision
	startedAt            time.Time
	estimatedInputTokens int
	reservedTokens       int64
	inboundProtocol      string
	budgetCheck          *quota.CheckResult
}

func (s *Server) tryServeFromCache(ctx cacheServeContext) bool {
	if s.cacheService == nil {
		return false
	}
	hit, ok := s.cacheService.Lookup(ctx.identity.TenantID, ctx.identity.UserID, ctx.req)
	if s.metrics != nil {
		layer := string(hit.Layer)
		if layer == "" {
			layer = "none"
		}
		result := "miss"
		if ok {
			result = "hit"
		}
		s.metrics.RecordCacheLookup(layer, result)
	}
	if !ok {
		return false
	}
	if s.refuseCachedRequest(ctx.w, ctx.r, ctx.identity) {
		return true
	}
	if s.metrics != nil {
		s.metrics.RecordCacheHit(string(hit.Layer))
	}
	usage := hit.Entry.Usage
	if hit.Layer == cache.LayerL1 || hit.Layer == cache.LayerL2 {
		usage = s.cacheService.GatewayCacheUsage(hit.Entry, s.cacheService.Config().CacheDiscountRatio)
	}

	latencyTotal := time.Since(ctx.startedAt).Milliseconds()
	ev := audit.Event{
		ID:                 makeID("audit"),
		TenantID:           ctx.identity.TenantID,
		EventTime:          time.Now().UTC().Format(time.RFC3339),
		EventType:          "chat_call",
		UserID:             ctx.identity.UserID,
		UserEmail:          ctx.identity.UserEmail,
		DepartmentID:       ctx.identity.DepartmentID,
		SessionID:          ctx.identity.SessionID,
		TraceID:            ctx.identity.TraceID,
		DeploymentID:       ctx.identity.DeploymentID,
		ClientType:         "web-portal",
		ClientIP:           ctx.r.RemoteAddr,
		Provider:           ctx.decision.Provider,
		Model:              ctx.req.Model,
		Route:              ctx.decision.Route,
		InboundProtocol:    ctx.inboundProtocol,
		CacheLayer:         string(hit.Layer),
		CacheKeyHash:       hit.KeyHash,
		SemanticSimilarity: hit.SemanticSimilarity,
		LatencyMS:          latencyTotal,
		LatencyMSUpstream:  0,
		InputTokens:        usage.PromptTokens,
		OutputTokens:       usage.CompletionTokens,
		TotalTokens:        usage.TotalTokens,
	}
	recordDiagnosticFailure(ctx.r.Context(), s.writeAuditEvent(ev), observability.ReasonInternalError)

	if s.refuseCachedRequest(ctx.w, ctx.r, ctx.identity) {
		return true
	}
	writer := &leaseCacheStreamWriter{ResponseWriter: ctx.w, identity: ctx.identity, request: ctx.r}
	if flusher, ok := ctx.w.(http.Flusher); ok {
		writer.flusher = flusher
	}
	if ctx.req.Stream {
		if writer.flusher == nil {
			writeAPIError(ctx.w, openai.Internal("streaming unsupported"))
			return true
		}
		var accounting streamAccounting
		index := 0
		writer.afterWrite = func() {
			if index < len(hit.Entry.StreamChunks) {
				accounting.observe(hit.Entry.StreamChunks[index])
				accounting.reported = nil
			}
			index++
		}
		err := cache.ReplayStream(writer, hit.Entry, s.cacheService.Config().ReplayMode)
		if err == nil {
			err = writer.err
		}
		if err != nil {
			recordDiagnosticFailure(ctx.r.Context(), err, observability.ReasonDownstreamError)
			partial := accounting.usage(ctx.estimatedInputTokens, true)
			if partial.TotalTokens > 0 {
				s.settleCachedUsage(ctx, partial, spanMeta{Status: "error", ErrorMessage: "cached stream interrupted"})
			}
			if errors.Is(err, quota.ErrConcurrencyLeaseLost) && writer.flusher != nil {
				writeStreamPolicyError(ctx.w, writer.flusher, "50302", formatStreamError(err), nil)
			}
			return true
		}
		s.settleCachedUsage(ctx, usage, spanMeta{})
		return true
	}
	resp := hit.Entry.Response
	resp.Usage = usage
	cache.WriteJSONResponse(writer, cache.Entry{Response: resp})
	if writer.err != nil {
		recordDiagnosticFailure(ctx.r.Context(), writer.err, observability.ReasonDownstreamError)
		if errors.Is(writer.err, quota.ErrConcurrencyLeaseLost) {
			writeAPIError(ctx.w, leaseAwareAPIError(writer.err))
		}
		return true
	}
	s.settleCachedUsage(ctx, usage, spanMeta{})
	return true
}

func (s *Server) writeChatCache(tenantID, userID string, req openai.ChatCompletionRequest, entry cache.Entry) {
	if s.cacheService == nil {
		return
	}
	s.cacheService.Write(tenantID, userID, req, entry)
}

func (s *Server) reportUsageDetailed(
	identity requestIdentity,
	decision routing.Decision,
	usage openai.Usage,
	budgetCheck *quota.CheckResult,
	span spanMeta,
) {
	n := metering.NormalizeUsage(usage)
	cost := float64(n.TotalTokens) * 0.000001
	pricingVersion := ""
	if table := s.activePricingTable(); table != nil {
		result := table.ComputeCost(decision.Model, usage, metering.CostContext{At: time.Now().UTC()})
		cost = result.CostUSD
		pricingVersion = result.PricingVersion
	}
	receipt := identity.quotaReservation
	if receipt == nil && budgetCheck != nil {
		receipt = budgetCheck.Reservation
	}
	if receipt != nil && s.quotaTracker != nil {
		if err := s.quotaTracker.FinishReservation(receipt, int64(n.TotalTokens), cost); err != nil {
			s.logger.Error("quota reservation settlement failed", "error", err)
		}
	} else if budgetCheck != nil && s.quotaTracker != nil {
		s.quotaTracker.SettleCheckedBudget(
			s.quotaContext(identity, decision.Model),
			*budgetCheck,
			int64(n.TotalTokens),
			cost,
		)
	}
	s.metering.ReportAsync(metering.UsageRecord{
		ID:                       makeID("usage"),
		TenantID:                 identity.TenantID,
		DeptID:                   identity.DepartmentID,
		UserID:                   identity.UserID,
		APITokenID:               identity.APITokenID,
		Provider:                 decision.Provider,
		Model:                    decision.Model,
		Route:                    decision.Route,
		TimeBucket:               time.Now().UTC(),
		InputTokens:              n.PromptTokens,
		OutputTokens:             n.CompletionTokens,
		TotalTokens:              n.TotalTokens,
		CachedTokens:             n.CachedTokens,
		CacheReadInputTokens:     n.CacheReadInputTokens,
		CacheCreationInputTokens: n.CacheCreationInputTokens,
		ReasoningTokens:          n.ReasoningTokens,
		UsageSource:              n.Source,
		CostUSD:                  cost,
		PricingVersion:           pricingVersion,
		TraceID:                  identity.TraceID,
		TraceStep:                identity.TraceStep,
	})
	if s.traceReporter != nil && strings.TrimSpace(identity.TraceID) != "" && identity.TraceStep > 0 {
		meta := map[string]any{}
		if identity.diagnostics != nil {
			meta["request_phases"] = identity.diagnostics.Snapshot().TraceMetadata()
		}
		if stage := strings.TrimSpace(firstNonEmpty(span.Stage, identity.TraceStage)); stage != "" {
			meta["stage"] = stage
		}
		if decision.Route != "" {
			meta["route"] = decision.Route
		}
		if io := metering.BuildTraceIOMetadata(span.PromptText, span.CompletionText); io != nil {
			meta["io"] = io
		}
		if sid := strings.TrimSpace(identity.SessionID); sid != "" {
			meta["session_id"] = sid
		}
		if did := strings.TrimSpace(identity.DeploymentID); did != "" {
			meta["deployment_id"] = did
		}
		meta = metering.CapTraceMetadata(meta)
		s.traceReporter.ReportAsync(metering.TraceSpanRecord{
			ID:              makeID("trace"),
			TenantID:        identity.TenantID,
			TraceID:         identity.TraceID,
			StepNo:          identity.TraceStep,
			StepKind:        "model",
			Status:          defaultIfEmpty(span.Status, "ok"),
			Model:           decision.Model,
			Provider:        decision.Provider,
			InputTokens:     n.PromptTokens,
			OutputTokens:    n.CompletionTokens,
			ReasoningTokens: n.ReasoningTokens,
			TotalTokens:     n.TotalTokens,
			CostUSD:         cost,
			DurationMS:      span.DurationMS,
			ErrorMessage:    span.ErrorMessage,
			Metadata:        meta,
		})
	}
}

func durationMSSince(startedAt time.Time) int {
	if startedAt.IsZero() {
		return 0
	}
	ms := time.Since(startedAt).Milliseconds()
	if ms < 0 {
		return 0
	}
	if ms > int64(^uint(0)>>1) {
		return int(^uint(0) >> 1)
	}
	return int(ms)
}

func defaultIfEmpty(value, fallback string) string {
	if strings.TrimSpace(value) == "" {
		return fallback
	}
	return value
}

func firstNonEmpty(values ...string) string {
	for _, v := range values {
		if strings.TrimSpace(v) != "" {
			return strings.TrimSpace(v)
		}
	}
	return ""
}

// sanitizeTraceError truncates and strips credential-looking tokens from error text.
func sanitizeTraceError(msg string) string {
	msg = strings.TrimSpace(metering.RedactTraceText(msg))
	if msg == "" {
		return ""
	}
	// Drop leftover credential header names so ops screens never show them.
	for _, needle := range []string{"Authorization", "authorization", "api_key", "apiKey", "API_KEY", "Bearer", "bearer"} {
		msg = strings.ReplaceAll(msg, needle, "[REDACTED]")
	}
	const maxLen = 500
	if utf8.RuneCountInString(msg) <= maxLen {
		return msg
	}
	runes := []rune(msg)
	return string(runes[:maxLen])
}

func (s *Server) auditChatCall(ev audit.Event, cacheLayer cache.Layer, keyHash string, sim float64, upstreamMS int64) audit.Event {
	if cacheLayer != cache.LayerNone {
		ev.CacheLayer = string(cacheLayer)
		ev.CacheKeyHash = keyHash
		ev.SemanticSimilarity = sim
	}
	if upstreamMS >= 0 {
		ev.LatencyMSUpstream = upstreamMS
	}
	return ev
}

func inboundProtocolLabel(label string) string {
	if strings.TrimSpace(label) == "" {
		return "openai-chat"
	}
	return label
}

func (s *Server) tryServeProtocolCache(w http.ResponseWriter, ctx cacheServeContext, session protocolSession) bool {
	if s.cacheService == nil {
		return false
	}
	hit, ok := s.cacheService.Lookup(ctx.identity.TenantID, ctx.identity.UserID, ctx.req)
	if s.metrics != nil {
		layer := string(hit.Layer)
		if layer == "" {
			layer = "none"
		}
		result := "miss"
		if ok {
			result = "hit"
		}
		s.metrics.RecordCacheLookup(layer, result)
	}
	if !ok {
		return false
	}
	if s.refuseCachedRequest(ctx.w, ctx.r, ctx.identity) {
		return true
	}
	if s.metrics != nil {
		s.metrics.RecordCacheHit(string(hit.Layer))
	}
	usage := hit.Entry.Usage
	if hit.Layer == cache.LayerL1 || hit.Layer == cache.LayerL2 {
		usage = s.cacheService.GatewayCacheUsage(hit.Entry, s.cacheService.Config().CacheDiscountRatio)
	}

	resp := hit.Entry.Response
	resp.Usage = usage
	_ = s.writeAuditEvent(audit.Event{
		ID:                 makeID("audit"),
		TenantID:           ctx.identity.TenantID,
		EventTime:          time.Now().UTC().Format(time.RFC3339),
		EventType:          "chat_call",
		UserID:             ctx.identity.UserID,
		UserEmail:          ctx.identity.UserEmail,
		DepartmentID:       ctx.identity.DepartmentID,
		SessionID:          ctx.identity.SessionID,
		TraceID:            ctx.identity.TraceID,
		DeploymentID:       ctx.identity.DeploymentID,
		ClientType:         "web-portal",
		ClientIP:           ctx.r.RemoteAddr,
		Provider:           ctx.decision.Provider,
		Model:              ctx.req.Model,
		Route:              ctx.decision.Route,
		InboundProtocol:    ctx.inboundProtocol,
		CacheLayer:         string(hit.Layer),
		CacheKeyHash:       hit.KeyHash,
		SemanticSimilarity: hit.SemanticSimilarity,
		LatencyMS:          time.Since(ctx.startedAt).Milliseconds(),
		LatencyMSUpstream:  0,
		InputTokens:        usage.PromptTokens,
		OutputTokens:       usage.CompletionTokens,
		TotalTokens:        usage.TotalTokens,
	})
	if s.refuseCachedRequest(w, ctx.r, ctx.identity) {
		return true
	}
	guarded := &leaseCacheStreamWriter{ResponseWriter: w, identity: ctx.identity, request: ctx.r}
	w = guarded
	switch session.outbound {
	case inbound.ProtocolClaude:
		enc := outbound.NewClaudeStreamEncoder(ctx.req.Model)
		writeJSON(w, http.StatusOK, enc.CompleteResponse(resp))
	case inbound.ProtocolGemini:
		enc := outbound.NewGeminiStreamEncoder(ctx.req.Model)
		writeJSON(w, http.StatusOK, enc.CompleteResponse(resp))
	case inbound.ProtocolResponses:
		text := ""
		if len(resp.Choices) > 0 {
			text = openai.ContentText(resp.Choices[0].Message.Content)
		}
		enc := outbound.NewResponsesStreamEncoder(ctx.req.Model)
		writeJSON(w, http.StatusOK, enc.Completed(text, usage))
	default:
		cache.WriteJSONResponse(w, cache.Entry{Response: resp})
	}
	if guarded.err != nil {
		if errors.Is(guarded.err, quota.ErrConcurrencyLeaseLost) {
			writeAPIError(guarded.ResponseWriter, leaseAwareAPIError(guarded.err))
		}
		return true
	}
	s.settleCachedUsage(ctx, usage, spanMeta{})
	return true
}

func (s *Server) settleCachedUsage(ctx cacheServeContext, usage openai.Usage, span spanMeta) {
	span.DurationMS = durationMSSince(ctx.startedAt)
	s.reportUsageDetailed(ctx.identity, ctx.decision, usage, ctx.budgetCheck, span)
	if s.useChannelRelay() {
		s.billingService.SettleContext(s.quotaContext(ctx.identity, ctx.req.Model), ctx.reservedTokens, int64(usage.TotalTokens))
	} else {
		s.reconcileQuotaUsage(ctx.identity, ctx.req.Model, ctx.estimatedInputTokens, usage.TotalTokens)
	}
}
