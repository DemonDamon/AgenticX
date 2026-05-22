package server

import (
	"net/http"
	"strings"
	"time"

	"github.com/agenticx/enterprise/gateway/internal/audit"
	"github.com/agenticx/enterprise/gateway/internal/cache"
	"github.com/agenticx/enterprise/gateway/internal/inbound"
	"github.com/agenticx/enterprise/gateway/internal/metering"
	"github.com/agenticx/enterprise/gateway/internal/openai"
	"github.com/agenticx/enterprise/gateway/internal/outbound"
	"github.com/agenticx/enterprise/gateway/internal/routing"
)

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
	if s.metrics != nil {
		s.metrics.RecordCacheHit(string(hit.Layer))
	}
	usage := hit.Entry.Usage
	if hit.Layer == cache.LayerL1 || hit.Layer == cache.LayerL2 {
		usage = s.cacheService.GatewayCacheUsage(hit.Entry, s.cacheService.Config().CacheDiscountRatio)
	}
	s.reportUsageDetailed(ctx.identity, ctx.decision, usage)
	if s.useChannelRelay() {
		actual := int64(usage.PromptTokens + usage.CompletionTokens)
		s.billingService.Settle(
			ctx.identity.UserID,
			ctx.identity.DepartmentID,
			roleFromScopes(ctx.identity.Scopes),
			ctx.req.Model,
			ctx.reservedTokens,
			actual,
		)
	} else {
		s.reconcileQuotaUsage(ctx.identity, ctx.req.Model, ctx.estimatedInputTokens, usage.PromptTokens+usage.CompletionTokens)
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
	_ = s.writeAuditEvent(ev)

	if ctx.req.Stream {
		_ = cache.ReplayStream(ctx.w, hit.Entry, s.cacheService.Config().ReplayMode)
		return true
	}
	if len(hit.Entry.Response.Choices) > 0 {
		resp := hit.Entry.Response
		resp.Usage = usage
		cache.WriteJSONResponse(ctx.w, cache.Entry{Response: resp})
		return true
	}
	cache.WriteJSONResponse(ctx.w, hit.Entry)
	return true
}

func (s *Server) writeChatCache(tenantID, userID string, req openai.ChatCompletionRequest, entry cache.Entry) {
	if s.cacheService == nil {
		return
	}
	s.cacheService.Write(tenantID, userID, req, entry)
}

func (s *Server) reportUsageDetailed(identity requestIdentity, decision routing.Decision, usage openai.Usage) {
	n := metering.NormalizeUsage(usage)
	cost := float64(n.TotalTokens) * 0.000001
	if s.pricing != nil {
		cost = s.pricing.ComputeCostUSD(decision.Model, usage)
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
	})
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
	if s.metrics != nil {
		s.metrics.RecordCacheHit(string(hit.Layer))
	}
	usage := hit.Entry.Usage
	if hit.Layer == cache.LayerL1 || hit.Layer == cache.LayerL2 {
		usage = s.cacheService.GatewayCacheUsage(hit.Entry, s.cacheService.Config().CacheDiscountRatio)
	}
	s.reportUsageDetailed(ctx.identity, ctx.decision, usage)
	if s.useChannelRelay() {
		actual := int64(usage.PromptTokens + usage.CompletionTokens)
		s.billingService.Settle(
			ctx.identity.UserID,
			ctx.identity.DepartmentID,
			roleFromScopes(ctx.identity.Scopes),
			ctx.req.Model,
			ctx.reservedTokens,
			actual,
		)
	} else {
		s.reconcileQuotaUsage(ctx.identity, ctx.req.Model, ctx.estimatedInputTokens, usage.PromptTokens+usage.CompletionTokens)
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
			text = resp.Choices[0].Message.Content
		}
		enc := outbound.NewResponsesStreamEncoder(ctx.req.Model)
		writeJSON(w, http.StatusOK, enc.Completed(text, usage))
	default:
		cache.WriteJSONResponse(w, cache.Entry{Response: resp})
	}
	return true
}
