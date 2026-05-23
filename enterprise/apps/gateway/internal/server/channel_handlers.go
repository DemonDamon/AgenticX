package server

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/agenticx/enterprise/gateway/internal/audit"
	"github.com/agenticx/enterprise/gateway/internal/cache"
	"github.com/agenticx/enterprise/gateway/internal/openai"
	"github.com/agenticx/enterprise/gateway/internal/relay"
	"github.com/agenticx/enterprise/gateway/internal/routing"
	"github.com/agenticx/enterprise/gateway/internal/wasmhost"
)

func (s *Server) handleChatCompleteRelay(
	w http.ResponseWriter,
	r *http.Request,
	req openai.ChatCompletionRequest,
	startedAt time.Time,
	identity requestIdentity,
	estimatedInputTokens int,
	reservedTokens int64,
	pluginCtx *wasmhost.HookContext,
) {
	result, err := s.relayExecutor.Complete(r.Context(), req, req.Model, channelIdentity(identity))
	decision := routingDecisionFromRelay(result, req.Model, s.decider.Decide(r, req.Model))
	if err != nil {
		s.billingService.Rollback(identity.UserID, reservedTokens)
		s.recordUpstreamError(identity.TenantID, makeID("req"), result.Channel.ID, 500, []byte(err.Error()))
		writeAPIError(w, openai.Internal(err.Error()))
		return
	}
	resp := result.Response
	responseContent := ""
	if len(resp.Choices) > 0 {
		msg := &resp.Choices[0].Message
		responseContent = openai.ComposeMessageContent(msg.Content, msg.ReasoningContent)
		msg.Content = responseContent
		msg.ReasoningContent = ""
	}
	providerInputTokens := resp.Usage.PromptTokens
	providerOutputTokens := resp.Usage.CompletionTokens
	if providerInputTokens == 0 {
		providerInputTokens = estimatedInputTokens
	}
	if providerOutputTokens == 0 {
		providerOutputTokens = estimateTextTokens(responseContent)
	}
	actualTotal := int64(providerInputTokens + providerOutputTokens)
	settle := s.billingService.Settle(
		identity.UserID,
		identity.DepartmentID,
		roleFromScopes(identity.Scopes),
		req.Model,
		reservedTokens,
		actualTotal,
	)
	s.reportUsageDetailed(identity, decision, resp.Usage)

	s.writeChatCache(identity.TenantID, identity.UserID, req, cache.Entry{
		Stream:   false,
		Response: resp,
		Usage:    resp.Usage,
	})

	if len(resp.Choices) > 0 {
		respPolicy := s.evaluatePolicy(resp.Choices[0].Message.Content, makeEvalContext(identity, "response"))
		if respPolicy.Blocked {
			s.logger.Warn("policy blocked response", "model", req.Model, "hits", len(respPolicy.Hits))
			ev := audit.Event{
				ID:              makeID("audit"),
				TenantID:        identity.TenantID,
				EventTime:       time.Now().UTC().Format(time.RFC3339),
				EventType:       "policy_hit",
				UserID:          identity.UserID,
				UserEmail:       identity.UserEmail,
				DepartmentID:    identity.DepartmentID,
				SessionID:       identity.SessionID,
				ClientType:      "web-portal",
				ClientIP:        r.RemoteAddr,
				Provider:        decision.Provider,
				Model:           req.Model,
				Route:           decision.Route,
				Digest:          &audit.Digest{PromptHash: hashText(joinMessages(req.Messages)), ResponseHash: hashText(resp.Choices[0].Message.Content)},
				PoliciesHit:     toAuditPolicyHits(respPolicy.Hits),
				LatencyMS:       time.Since(startedAt).Milliseconds(),
				EstimatedTokens: estimatedInputTokens,
				ActualTokens:    providerInputTokens + providerOutputTokens,
				SettleDelta:     settle.Delta,
			}
			enrichAuditFromAttempts(&ev, result.Attempts)
			if err := s.writeAuditEvent(ev); err != nil {
				writeAPIError(w, openai.Internal("audit write failed"))
				return
			}
			writePolicyError(w, "90002", "响应触发合规拦截", respPolicy.Hits)
			return
		}
		if respPolicy.RedactedText != resp.Choices[0].Message.Content {
			resp.Choices[0].Message.Content = respPolicy.RedactedText
		}
	}

	s.transformChatResponseJSON(pluginCtx, &resp)
	if len(resp.Choices) > 0 {
		responseContent = openai.ComposeMessageContent(resp.Choices[0].Message.Content, resp.Choices[0].Message.ReasoningContent)
	}

	ev := audit.Event{
		ID:              makeID("audit"),
		TenantID:        identity.TenantID,
		EventTime:       time.Now().UTC().Format(time.RFC3339),
		EventType:       "chat_call",
		UserID:          identity.UserID,
		UserEmail:       identity.UserEmail,
		DepartmentID:    identity.DepartmentID,
		SessionID:       identity.SessionID,
		ClientType:      "web-portal",
		ClientIP:        r.RemoteAddr,
		Provider:        decision.Provider,
		Model:           req.Model,
		Route:           decision.Route,
		ChannelID:       decision.ChannelID,
		ChannelKeyRef:   result.KeyRef,
		APITokenID:      identity.APITokenID,
		InputTokens:     providerInputTokens,
		OutputTokens:    providerOutputTokens,
		TotalTokens:     providerInputTokens + providerOutputTokens,
		LatencyMS:       time.Since(startedAt).Milliseconds(),
		LatencyMSUpstream: time.Since(startedAt).Milliseconds(),
		EstimatedTokens: estimatedInputTokens,
		ActualTokens:    providerInputTokens + providerOutputTokens,
		SettleDelta:     settle.Delta,
		CacheLayer:      string(cache.LayerNone),
		Digest: &audit.Digest{
			PromptHash:      hashText(joinMessages(req.Messages)),
			ResponseHash:    hashText(responseContent),
			PromptSummary:   summarize(joinMessages(req.Messages), 120),
			ResponseSummary: summarize(responseContent, 120),
		},
	}
	enrichAuditFromAttempts(&ev, result.Attempts)
	applyPluginsInvoked(&ev, pluginCtx)
	if err := s.writeAuditEvent(ev); err != nil {
		writeAPIError(w, openai.Internal("audit write failed"))
		return
	}
	writeJSON(w, http.StatusOK, resp)
}

func routingDecisionFromRelay(result relay.CompleteResult, model string, fallback routing.Decision) routing.Decision {
	if result.Channel.ID != "" {
		return decisionFromChannel(result.Channel, model)
	}
	return fallback
}

func (s *Server) handleChannelStats(w http.ResponseWriter, r *http.Request) {
	if !gatewayInternalAuthorized(r) {
		writeAPIError(w, openai.Unauthorized("unauthorized"))
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"code":    "00000",
		"message": "ok",
		"data": map[string]any{
			"enabled": s.useChannelRelay(),
			"stats":   s.channelStatsJSON(),
		},
	})
}

func (s *Server) handleKeypoolStats(w http.ResponseWriter, r *http.Request) {
	if !gatewayInternalAuthorized(r) {
		writeAPIError(w, openai.Unauthorized("unauthorized"))
		return
	}
	channelID := strings.TrimSpace(r.URL.Query().Get("channel_id"))
	keyRefsRaw := strings.TrimSpace(r.URL.Query().Get("key_refs"))
	if channelID == "" {
		writeAPIError(w, openai.BadRequest("channel_id is required"))
		return
	}
	var refs []string
	if keyRefsRaw != "" {
		for _, part := range strings.Split(keyRefsRaw, ",") {
			if t := strings.TrimSpace(part); t != "" {
				refs = append(refs, t)
			}
		}
	}
	poolID := channelID
	if s.keyPool == nil {
		writeJSON(w, http.StatusOK, map[string]any{"code": "00000", "message": "ok", "data": map[string]any{"keys": []any{}}})
		return
	}
	stats := s.keyPool.Stats(poolID, refs)
	writeJSON(w, http.StatusOK, map[string]any{
		"code":    "00000",
		"message": "ok",
		"data": map[string]any{
			"channel_id": channelID,
			"keys":       stats,
		},
	})
}

func (s *Server) handleKeypoolReset(w http.ResponseWriter, r *http.Request) {
	if !gatewayInternalAuthorized(r) {
		writeAPIError(w, openai.Unauthorized("unauthorized"))
		return
	}
	var body struct {
		ChannelID string `json:"channel_id"`
		KeyRef    string `json:"key_ref"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeAPIError(w, openai.BadRequest("invalid body"))
		return
	}
	if s.keyPool == nil || strings.TrimSpace(body.ChannelID) == "" || strings.TrimSpace(body.KeyRef) == "" {
		writeAPIError(w, openai.BadRequest("channel_id and key_ref required"))
		return
	}
	s.keyPool.ResetCooldown(body.ChannelID, body.KeyRef)
	writeJSON(w, http.StatusOK, map[string]any{"code": "00000", "message": "ok"})
}

func gatewayInternalAuthorized(r *http.Request) bool {
	expected := strings.TrimSpace(os.Getenv("GATEWAY_INTERNAL_TOKEN"))
	if expected == "" {
		return false
	}
	auth := r.Header.Get("authorization")
	const prefix = "Bearer "
	if len(auth) < len(prefix) || !strings.EqualFold(auth[:len(prefix)], prefix) {
		return false
	}
	return strings.TrimSpace(auth[len(prefix):]) == expected
}

func streamErrorCode(err error) string {
	if err == nil {
		return ""
	}
	msg := err.Error()
	if strings.Contains(msg, "stream:buffer_exceeded") {
		return "90002"
	}
	if strings.Contains(msg, "stream:idle_timeout") {
		return "90002"
	}
	return ""
}

func formatStreamError(err error) string {
	if err == nil {
		return "stream failed"
	}
	return fmt.Sprintf("%v", err)
}

func routingDecisionFromStream(result relay.StreamResult, model string, fallback routing.Decision) routing.Decision {
	if result.Channel.ID != "" {
		return decisionFromChannel(result.Channel, model)
	}
	return fallback
}
