package server

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/agenticx/enterprise/gateway/internal/adaptor"
	"github.com/agenticx/enterprise/gateway/internal/audit"
	"github.com/agenticx/enterprise/gateway/internal/cache"
	"github.com/agenticx/enterprise/gateway/internal/channel"
	"github.com/agenticx/enterprise/gateway/internal/inbound"
	"github.com/agenticx/enterprise/gateway/internal/openai"
	"github.com/agenticx/enterprise/gateway/internal/outbound"
	"github.com/agenticx/enterprise/gateway/internal/relay"
	"github.com/agenticx/enterprise/gateway/internal/routing"
	"github.com/agenticx/enterprise/gateway/internal/transform"
	policyengine "github.com/agenticx/enterprise/policy-engine"
)

type protocolSession struct {
	inbound  string
	outbound string
}

func (s *Server) handleClaudeMessages(w http.ResponseWriter, r *http.Request) {
	if !claudeInboundEnabled() {
		writeAPIError(w, openai.BadRequest("claude inbound disabled"))
		return
	}
	req, identity, err := s.parseProtocolRequest(r, func(body *http.Request) (openai.ChatCompletionRequest, error) {
		return inbound.ParseClaudeMessages(body.Body)
	})
	if err != nil {
		if strings.Contains(err.Error(), "bearer") || strings.Contains(err.Error(), "auth:") {
			writeAPIError(w, openai.Unauthorized(err.Error()))
			return
		}
		if strings.Contains(err.Error(), "scope") {
			writeAPIError(w, openai.Forbidden(err.Error()))
			return
		}
		writeAPIError(w, openai.BadRequest(err.Error()))
		return
	}
	s.dispatchProtocol(w, r, req, identity, protocolSession{inbound: inbound.ProtocolClaude, outbound: outbound.ProtocolClaude})
}

func (s *Server) handleGeminiGenerate(w http.ResponseWriter, r *http.Request, model string, stream bool) {
	if !geminiInboundEnabled() {
		writeAPIError(w, openai.BadRequest("gemini inbound disabled"))
		return
	}
	req, identity, err := s.parseProtocolRequest(r, func(body *http.Request) (openai.ChatCompletionRequest, error) {
		return inbound.ParseGeminiGenerate(body.Body, model, stream)
	})
	if err != nil {
		writeAPIError(w, openai.BadRequest(err.Error()))
		return
	}
	s.dispatchProtocol(w, r, req, identity, protocolSession{inbound: inbound.ProtocolGemini, outbound: outbound.ProtocolGemini})
}

func (s *Server) handleResponses(w http.ResponseWriter, r *http.Request) {
	if !responsesInboundEnabled() {
		writeAPIError(w, openai.BadRequest("responses inbound disabled"))
		return
	}
	req, identity, err := s.parseProtocolRequest(r, func(body *http.Request) (openai.ChatCompletionRequest, error) {
		return inbound.ParseResponses(body.Body)
	})
	if err != nil {
		writeAPIError(w, openai.BadRequest(err.Error()))
		return
	}
	s.dispatchProtocol(w, r, req, identity, protocolSession{inbound: inbound.ProtocolResponses, outbound: outbound.ProtocolResponses})
}

func (s *Server) parseProtocolRequest(
	r *http.Request,
	parse func(*http.Request) (openai.ChatCompletionRequest, error),
) (openai.ChatCompletionRequest, requestIdentity, error) {
	identity, err := s.identityFromRequest(r)
	if err != nil {
		return openai.ChatCompletionRequest{}, requestIdentity{}, err
	}
	if !hasScope(identity.Scopes, "workspace:chat") {
		return openai.ChatCompletionRequest{}, requestIdentity{}, fmt.Errorf("missing workspace:chat scope")
	}
	if identity.AuthViaPAT && identity.APITokenID > 0 && s.patVerifier != nil {
		s.patVerifier.NoteUsed(identity.APITokenID)
	}
	req, err := parse(r)
	if err != nil {
		return openai.ChatCompletionRequest{}, requestIdentity{}, err
	}
	req, _ = applyDerivedModel(req)
	if req.System != "" {
		req.Messages = prependSystemMessage(req.Messages, req.System)
		req.System = ""
	}
	return req, identity, nil
}

func applyDerivedModel(req openai.ChatCompletionRequest) (openai.ChatCompletionRequest, transform.DerivedModel) {
	derived := transform.ResolveModel(req.Model)
	req.Model = derived.UpstreamModel
	if derived.ReasoningEffort != "" {
		req.ReasoningEffort = derived.ReasoningEffort
	}
	if derived.ThinkingEnabled {
		req.ThinkingBudget = derived.ThinkingBudget
	}
	return req, derived
}

func prependSystemMessage(messages []openai.ChatMessage, system string) []openai.ChatMessage {
	if strings.TrimSpace(system) == "" {
		return messages
	}
	out := make([]openai.ChatMessage, 0, len(messages)+1)
	out = append(out, openai.ChatMessage{Role: "system", Content: system})
	out = append(out, messages...)
	return out
}

func (s *Server) dispatchProtocol(
	w http.ResponseWriter,
	r *http.Request,
	req openai.ChatCompletionRequest,
	identity requestIdentity,
	session protocolSession,
) {
	startedAt := time.Now()
	_, derived := applyDerivedModel(req)
	thinkingMode := transform.ThinkingModeFromEnv()

	qctx := s.quotaContext(identity, req.Model)
	defer s.billingService.ReleaseContext(qctx)

	latestUserText := latestUserMessageContent(req.Messages)
	reqPolicy := s.evaluatePolicy(latestUserText, makeEvalContext(identity, "request"))
	if reqPolicy.Blocked {
		writePolicyError(w, "90001", "请求触发合规拦截", reqPolicy.Hits)
		return
	}
	if reqPolicy.RedactedText != latestUserText {
		req.Messages = replaceLastUserMessageContent(req.Messages, reqPolicy.RedactedText)
	}

	estimatedInputTokens := estimateTextTokens(joinMessages(req.Messages))
	reserveTokens := estimateTokensWithMax(estimatedInputTokens, maxTokensFromRequest(req))
	if s.useChannelRelay() {
		quotaReservation := s.billingService.ReserveContext(qctx, reserveTokens)
		if !quotaReservation.Allowed {
			s.writeQuotaError(w, quotaReservation.Check)
			return
		}
		s.applyQuotaHeaders(w, quotaReservation.Check)
	} else {
		check := s.quotaTracker.CheckRequest(qctx, int64(estimatedInputTokens))
		if !check.Allowed {
			s.writeQuotaError(w, check)
			return
		}
		s.applyQuotaHeaders(w, check)
	}

	decision := s.decider.Decide(r, req.Model)
	if !req.Stream && s.tryServeProtocolCache(w, cacheServeContext{
		w: w, r: r, req: req, identity: identity, decision: decision, startedAt: startedAt,
		estimatedInputTokens: estimatedInputTokens, reservedTokens: reserveTokens,
		inboundProtocol: inboundProtocolLabel(session.inbound),
	}, session) {
		return
	}

	if req.Stream {
		s.protocolStream(w, r, req, identity, session, derived, thinkingMode, startedAt, estimatedInputTokens, reserveTokens)
		return
	}
	s.protocolComplete(w, r, req, identity, session, derived, thinkingMode, startedAt, estimatedInputTokens, reserveTokens)
}

func (s *Server) protocolComplete(
	w http.ResponseWriter,
	r *http.Request,
	req openai.ChatCompletionRequest,
	identity requestIdentity,
	session protocolSession,
	derived transform.DerivedModel,
	thinkingMode transform.ThinkingMode,
	startedAt time.Time,
	estimatedInputTokens int,
	reservedTokens int64,
) {
	if !s.useChannelRelay() {
		writeAPIError(w, openai.Internal("channel relay required for multi-protocol inbound"))
		return
	}
	result, err := s.relayExecutor.Complete(r.Context(), req, req.Model, channelIdentity(identity))
	decision := routingDecisionFromRelay(result, req.Model, s.decider.Decide(r, req.Model))
	if err != nil {
		s.billingService.Rollback(identity.UserID, reservedTokens)
		if up, ok := err.(*adaptor.UpstreamError); ok {
			writeAPIError(w, adaptor.MapUpstreamError(up.StatusCode, up.Body, session.inbound))
			return
		}
		writeAPIError(w, openai.Internal(err.Error()))
		return
	}
	resp := result.Response
	responseContent := ""
	if len(resp.Choices) > 0 {
		msg := &resp.Choices[0].Message
		if thinkingMode == transform.ThinkingSeparate {
			responseContent = openai.ComposeMessageContent(msg.Content, msg.ReasoningContent)
		} else {
			responseContent = openai.ComposeMessageContent(msg.Content, msg.ReasoningContent)
			msg.Content = responseContent
			msg.ReasoningContent = ""
		}
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
		Stream: false, Response: resp, Usage: resp.Usage,
	})

	outboundProto := outboundProtocolForChannel(result.Channel, session.outbound)
	ev := s.protocolAuditEvent(identity, r, decision, req.Model, session.inbound, outboundProto, derived, thinkingMode, startedAt, result, streamResultFromComplete(result), estimatedInputTokens, providerInputTokens, providerOutputTokens, settle.Delta, responseContent, req.Messages)
	if err := s.writeAuditEvent(ev); err != nil {
		writeAPIError(w, openai.Internal("audit write failed"))
		return
	}

	switch session.outbound {
	case inbound.ProtocolClaude:
		enc := outbound.NewClaudeStreamEncoder(req.Model)
		writeJSON(w, http.StatusOK, enc.CompleteResponse(resp))
	case inbound.ProtocolGemini:
		enc := outbound.NewGeminiStreamEncoder(req.Model)
		writeJSON(w, http.StatusOK, enc.CompleteResponse(resp))
	case inbound.ProtocolResponses:
		enc := outbound.NewResponsesStreamEncoder(req.Model)
		writeJSON(w, http.StatusOK, enc.Completed(responseContent, resp.Usage))
	default:
		writeJSON(w, http.StatusOK, resp)
	}
}

func streamResultFromComplete(result relay.CompleteResult) relay.StreamResult {
	return relay.StreamResult{Channel: result.Channel, KeyRef: result.KeyRef, Attempts: result.Attempts}
}

func (s *Server) protocolStream(
	w http.ResponseWriter,
	r *http.Request,
	req openai.ChatCompletionRequest,
	identity requestIdentity,
	session protocolSession,
	derived transform.DerivedModel,
	thinkingMode transform.ThinkingMode,
	startedAt time.Time,
	estimatedInputTokens int,
	reservedTokens int64,
) {
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	flusher, ok := w.(http.Flusher)
	if !ok {
		writeAPIError(w, openai.Internal("streaming unsupported"))
		return
	}

	var claudeEnc *outbound.ClaudeStreamEncoder
	var geminiEnc *outbound.GeminiStreamEncoder
	var responsesEnc *outbound.ResponsesStreamEncoder
	switch session.outbound {
	case inbound.ProtocolClaude:
		claudeEnc = outbound.NewClaudeStreamEncoder(req.Model)
		if line := claudeEnc.MessageStart(); len(line) > 0 {
			_, _ = w.Write(line)
			flusher.Flush()
		}
	case inbound.ProtocolResponses:
		responsesEnc = outbound.NewResponsesStreamEncoder(req.Model)
		if line := responsesEnc.Created(); len(line) > 0 {
			_, _ = w.Write(line)
			flusher.Flush()
		}
	case inbound.ProtocolGemini:
		geminiEnc = outbound.NewGeminiStreamEncoder(req.Model)
	}

	var responseBuilder strings.Builder
	var reasoningState openai.StreamReasoningState
	var blockedHits []policyengine.HitEvent

	push := func(chunk openai.StreamChunk) error {
		transform.ApplyStreamDelta(&chunk, thinkingMode)
		if len(chunk.Choices) > 0 {
			delta := &chunk.Choices[0].Delta
			delta.Content = openai.NormalizeThinkTags(delta.Content)
			delta.ReasoningContent = openai.NormalizeThinkTags(delta.ReasoningContent)
			if thinkingMode != transform.ThinkingSeparate {
				merged := reasoningState.MergeDelta(responseBuilder.String(), delta.ReasoningContent, delta.Content)
				if merged != "" {
					policyResult := s.evaluatePolicy(merged, makeEvalContext(identity, "response"))
					if policyResult.Blocked {
						blockedHits = append(blockedHits, policyResult.Hits...)
						return fmt.Errorf("policy blocked stream chunk")
					}
					delta.Content = policyResult.RedactedText
					responseBuilder.WriteString(delta.Content)
				}
				delta.ReasoningContent = ""
			} else if delta.Content != "" || delta.ReasoningContent != "" {
				responseBuilder.WriteString(delta.Content)
				if delta.ReasoningContent != "" {
					responseBuilder.WriteString(delta.ReasoningContent)
				}
			}
		}

		switch session.outbound {
		case inbound.ProtocolClaude:
			for _, line := range claudeEnc.EncodeChunk(chunk) {
				if _, err := w.Write(line); err != nil {
					return err
				}
			}
		case inbound.ProtocolGemini:
			for _, line := range geminiEnc.EncodeChunk(chunk) {
				if _, err := w.Write(line); err != nil {
					return err
				}
			}
		case inbound.ProtocolResponses:
			for _, line := range responsesEnc.EncodeChunk(chunk) {
				if _, err := w.Write(line); err != nil {
					return err
				}
			}
		default:
			payload, err := json.Marshal(chunk)
			if err != nil {
				return err
			}
			if _, err := w.Write([]byte("data: " + string(payload) + "\n\n")); err != nil {
				return err
			}
		}
		flusher.Flush()
		return nil
	}

	streamResult, streamErr := s.relayExecutor.Stream(r.Context(), req, req.Model, channelIdentity(identity), push)
	decision := routingDecisionFromStream(streamResult, req.Model, s.decider.Decide(r, req.Model))

	if streamErr != nil {
		s.billingService.Rollback(identity.UserID, reservedTokens)
		if len(blockedHits) > 0 {
			writeStreamPolicyError(w, flusher, "90002", "响应触发合规拦截", blockedHits)
			return
		}
		if up, ok := streamErr.(*adaptor.UpstreamError); ok {
			writeStreamError(w, flusher, adaptor.MapUpstreamError(up.StatusCode, up.Body, session.inbound).Message)
			return
		}
		writeStreamError(w, flusher, streamErr.Error())
		return
	}

	responseText := responseBuilder.String()
	if tail := reasoningState.CloseOpenReasoning(); tail != "" {
		responseText += tail
	}
	inputTokens := estimatedInputTokens
	outputTokens := estimateTextTokens(responseText)
	settle := s.billingService.Settle(
		identity.UserID,
		identity.DepartmentID,
		roleFromScopes(identity.Scopes),
		req.Model,
		reservedTokens,
		int64(inputTokens+outputTokens),
	)
	s.reportUsage(identity, decision, inputTokens, outputTokens)

	usage := openai.Usage{PromptTokens: inputTokens, CompletionTokens: outputTokens, TotalTokens: inputTokens + outputTokens}
	switch session.outbound {
	case inbound.ProtocolClaude:
		for _, line := range claudeEnc.Final(usage) {
			_, _ = w.Write(line)
		}
	case inbound.ProtocolGemini:
		_, _ = w.Write([]byte("data: [DONE]\n\n"))
	case inbound.ProtocolResponses:
		if line := responsesEnc.Done(usage); len(line) > 0 {
			_, _ = w.Write(line)
		}
	}
	flusher.Flush()

	outboundProto := outboundProtocolForChannel(streamResult.Channel, session.outbound)
	ev := s.protocolAuditEvent(identity, r, decision, req.Model, session.inbound, outboundProto, derived, thinkingMode, startedAt, relay.CompleteResult{Channel: streamResult.Channel, KeyRef: streamResult.KeyRef}, streamResult, estimatedInputTokens, inputTokens, outputTokens, settle.Delta, responseText, req.Messages)
	_ = s.writeAuditEvent(ev)
}

func outboundProtocolForChannel(ch channel.Channel, clientProtocol string) string {
	if ch.ID == "" {
		return clientProtocol
	}
	switch strings.ToLower(strings.TrimSpace(ch.ProviderType)) {
	case "claude", "anthropic":
		return outbound.ProtocolClaude
	case "gemini", "google":
		return outbound.ProtocolGemini
	default:
		return "openai-compatible"
	}
}

func (s *Server) protocolAuditEvent(
	identity requestIdentity,
	r *http.Request,
	decision routing.Decision,
	model string,
	inboundProto string,
	outboundProto string,
	derived transform.DerivedModel,
	thinkingMode transform.ThinkingMode,
	startedAt time.Time,
	result relay.CompleteResult,
	streamResult relay.StreamResult,
	estimatedInput int,
	inputTokens int,
	outputTokens int,
	settleDelta int64,
	responseText string,
	messages []openai.ChatMessage,
) audit.Event {
	ev := audit.Event{
		ID:               makeID("audit"),
		TenantID:         identity.TenantID,
		EventTime:        time.Now().UTC().Format(time.RFC3339),
		EventType:        "chat_call",
		UserID:           identity.UserID,
		UserEmail:        identity.UserEmail,
		DepartmentID:     identity.DepartmentID,
		SessionID:        identity.SessionID,
		ClientType:       "multi-protocol",
		ClientIP:         r.RemoteAddr,
		Provider:         decision.Provider,
		Model:            model,
		Route:            decision.Route,
		ChannelID:        decision.ChannelID,
		ChannelKeyRef:    result.KeyRef,
		APITokenID:       identity.APITokenID,
		InboundProtocol:  inboundProto,
		OutboundProtocol: outboundProto,
		ReasoningEffort:  derived.ReasoningEffort,
		ThinkingMode:     string(thinkingMode),
		InputTokens:      inputTokens,
		OutputTokens:     outputTokens,
		TotalTokens:      inputTokens + outputTokens,
		LatencyMS:        time.Since(startedAt).Milliseconds(),
		EstimatedTokens:  estimatedInput,
		ActualTokens:     inputTokens + outputTokens,
		SettleDelta:      settleDelta,
		Digest: &audit.Digest{
			PromptHash:      hashText(joinMessages(messages)),
			ResponseHash:    hashText(responseText),
			PromptSummary:   summarize(joinMessages(messages), 120),
			ResponseSummary: summarize(responseText, 120),
		},
	}
	enrichAuditFromAttempts(&ev, streamResult.Attempts)
	return ev
}
