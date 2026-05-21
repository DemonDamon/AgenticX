package server

import (
	"context"
	"encoding/json"
	"strings"

	"github.com/agenticx/enterprise/gateway/internal/adaptor"
	"github.com/agenticx/enterprise/gateway/internal/audit"
	"github.com/agenticx/enterprise/gateway/internal/billing"
	"github.com/agenticx/enterprise/gateway/internal/channel"
	"github.com/agenticx/enterprise/gateway/internal/keypool"
	"github.com/agenticx/enterprise/gateway/internal/openai"
	"github.com/agenticx/enterprise/gateway/internal/relay"
	"github.com/agenticx/enterprise/gateway/internal/routing"
)

func (s *Server) useChannelRelay() bool {
	if s == nil || s.channelRegistry == nil {
		return false
	}
	if !s.channelRegistry.Enabled() {
		return false
	}
	return s.channelRegistry.HasChannels()
}

func channelIdentity(identity requestIdentity) channel.Identity {
	return channel.Identity{
		TenantID:  identity.TenantID,
		UserID:    identity.UserID,
		SessionID: identity.SessionID,
	}
}

func decisionFromChannel(ch channel.Channel, model string) routing.Decision {
	route := strings.TrimSpace(ch.Route)
	if route == "" {
		route = "third-party"
	}
	provider := strings.TrimSpace(ch.ProviderLabel)
	if provider == "" {
		provider = ch.Name
	}
	return routing.Decision{
		Route:     route,
		Provider:  provider,
		Endpoint:  ch.BaseURL,
		APIKey:    ch.APIKey,
		Model:     model,
		ChannelID: ch.ID,
	}
}

func estimateTokensWithMax(inputTokens, maxTokens int) int64 {
	out := int64(inputTokens)
	if maxTokens > 0 {
		out += int64(maxTokens)
	}
	if out <= 0 {
		return 1
	}
	return out
}

func maxTokensFromRequest(req openai.ChatCompletionRequest) int {
	if req.MaxCompletionTokens > 0 {
		return req.MaxCompletionTokens
	}
	return req.MaxTokens
}

func enrichAuditFromAttempts(event *audit.Event, attempts []channel.Attempt) {
	if event == nil || len(attempts) == 0 {
		return
	}
	event.Attempts = channel.AttemptsJSON(attempts)
	last := attempts[len(attempts)-1]
	event.ChannelID = last.ChannelID
	event.AttemptIndex = len(attempts) - 1
	if !last.Success {
		event.RetryReason = last.RetryReason
	}
}

func (s *Server) initChannelRelay() {
	openaiAdaptor := adaptor.NewOpenAIAdaptor()
	s.adaptorFactory = adaptor.NewFactory(openaiAdaptor)
	s.keyPool = keypool.NewPool()
	s.channelStats = channel.NewStatsStore()
	s.channelAffinity = channel.NewAffinityStore(0)
	s.channelRegistry = channel.NewRegistry(s.logger, s.adminLoader)
	s.channelRegistry.Start(context.Background())
	s.channelPicker = channel.NewPicker(s.channelRegistry, s.channelStats, s.channelAffinity)
	s.relayExecutor = relay.NewExecutor(s.channelPicker, s.adaptorFactory, s.keyPool)
	s.billingService = billing.NewService(s.quotaTracker)
}

func (s *Server) channelStatsJSON() map[string]any {
	if s.channelStats == nil {
		return map[string]any{}
	}
	raw := s.channelStats.Snapshot()
	out := make(map[string]any, len(raw))
	for id, st := range raw {
		stat := st
		out[id] = map[string]any{
			"success_count":  stat.SuccessCount,
			"failure_count":  stat.FailureCount,
			"success_rate":   stat.SuccessRate(),
			"p50_latency_ms": stat.P50LatencyMS(),
			"last_error":     stat.LastError,
			"cooldown_until": func() any {
				if stat.CooldownUntil.IsZero() {
					return nil
				}
				return stat.CooldownUntil.UTC().Format("2006-01-02T15:04:05Z")
			}(),
		}
	}
	return out
}

func decodeAttempts(raw json.RawMessage) []channel.Attempt {
	if len(raw) == 0 {
		return nil
	}
	var attempts []channel.Attempt
	_ = json.Unmarshal(raw, &attempts)
	return attempts
}
