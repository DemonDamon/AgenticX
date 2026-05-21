package relay

import (
	"context"
	"errors"
	"fmt"
	"net"
	"strings"
	"time"

	"github.com/agenticx/enterprise/gateway/internal/adaptor"
	"github.com/agenticx/enterprise/gateway/internal/channel"
	"github.com/agenticx/enterprise/gateway/internal/keypool"
	"github.com/agenticx/enterprise/gateway/internal/openai"
)

const defaultMaxRetries = 2

// Executor 负责 Channel 选择、Key 解析、Adaptor 调用与失败重试。
type Executor struct {
	picker   *channel.Picker
	factory  *adaptor.Factory
	keypool  *keypool.Pool
	cooldown time.Duration
}

func NewExecutor(picker *channel.Picker, factory *adaptor.Factory, pool *keypool.Pool) *Executor {
	if pool == nil {
		pool = keypool.NewPool()
	}
	return &Executor{
		picker:   picker,
		factory:  factory,
		keypool:  pool,
		cooldown: 30 * time.Second,
	}
}

type CompleteResult struct {
	Response openai.ChatCompletionResponse
	Channel  channel.Channel
	Attempts []channel.Attempt
}

type StreamResult struct {
	Channel  channel.Channel
	Attempts []channel.Attempt
}

func (e *Executor) Complete(
	ctx context.Context,
	req openai.ChatCompletionRequest,
	model string,
	id channel.Identity,
) (CompleteResult, error) {
	var lastErr error
	exclude := map[string]struct{}{}
	attempts := make([]channel.Attempt, 0)
	maxRetries := defaultMaxRetries

	for attempt := 0; attempt <= maxRetries; attempt++ {
		ch, ok := e.picker.Pick(model, id, exclude)
		if !ok {
			if lastErr != nil {
				return CompleteResult{Attempts: attempts}, lastErr
			}
			return CompleteResult{Attempts: attempts}, fmt.Errorf("no channel for model %s", model)
		}
		if ch.MaxRetries > 0 {
			maxRetries = ch.MaxRetries
		}
		ch = e.resolveKey(ch)
		start := time.Now()
		ad, err := e.factory.For(ch)
		if err != nil {
			return CompleteResult{Attempts: attempts}, err
		}
		resp, err := ad.Complete(ctx, req, ch)
		latency := time.Since(start).Milliseconds()
		if err == nil {
			e.picker.MarkSuccess(id, model, ch, latency)
			attempts = append(attempts, channel.Attempt{
				ChannelID: ch.ID,
				Provider:  ch.ProviderLabel,
				Success:   true,
				LatencyMS: latency,
			})
			return CompleteResult{Response: resp, Channel: ch, Attempts: attempts}, nil
		}
		lastErr = err
		reason := err.Error()
		attempts = append(attempts, channel.Attempt{
			ChannelID:   ch.ID,
			Provider:    ch.ProviderLabel,
			Success:     false,
			RetryReason: reason,
			LatencyMS:   latency,
		})
		if !IsRetryable(err) {
			return CompleteResult{Attempts: attempts, Channel: ch}, err
		}
		e.picker.MarkFailure(ch, reason, e.cooldown)
		exclude[ch.ID] = struct{}{}
	}
	return CompleteResult{Attempts: attempts}, lastErr
}

func (e *Executor) Stream(
	ctx context.Context,
	req openai.ChatCompletionRequest,
	model string,
	id channel.Identity,
	push adaptor.StreamPush,
) (StreamResult, error) {
	var lastErr error
	exclude := map[string]struct{}{}
	attempts := make([]channel.Attempt, 0)
	maxRetries := defaultMaxRetries

	for attempt := 0; attempt <= maxRetries; attempt++ {
		ch, ok := e.picker.Pick(model, id, exclude)
		if !ok {
			if lastErr != nil {
				return StreamResult{Attempts: attempts}, lastErr
			}
			return StreamResult{Attempts: attempts}, fmt.Errorf("no channel for model %s", model)
		}
		if ch.MaxRetries > 0 {
			maxRetries = ch.MaxRetries
		}
		ch = e.resolveKey(ch)
		start := time.Now()
		ad, err := e.factory.For(ch)
		if err != nil {
			return StreamResult{Attempts: attempts}, err
		}
		err = ad.Stream(ctx, req, ch, push)
		latency := time.Since(start).Milliseconds()
		if err == nil {
			e.picker.MarkSuccess(id, model, ch, latency)
			attempts = append(attempts, channel.Attempt{
				ChannelID: ch.ID,
				Provider:  ch.ProviderLabel,
				Success:   true,
				LatencyMS: latency,
			})
			return StreamResult{Channel: ch, Attempts: attempts}, nil
		}
		lastErr = err
		reason := err.Error()
		attempts = append(attempts, channel.Attempt{
			ChannelID:   ch.ID,
			Provider:    ch.ProviderLabel,
			Success:     false,
			RetryReason: reason,
			LatencyMS:   latency,
		})
		if !IsRetryable(err) {
			return StreamResult{Attempts: attempts, Channel: ch}, err
		}
		e.picker.MarkFailure(ch, reason, e.cooldown)
		exclude[ch.ID] = struct{}{}
	}
	return StreamResult{Attempts: attempts}, lastErr
}

func (e *Executor) resolveKey(ch channel.Channel) channel.Channel {
	if strings.TrimSpace(ch.APIKey) != "" {
		return ch
	}
	poolID := ch.KeyPoolID()
	if poolID == "" {
		poolID = ch.ID
	}
	key := e.keypool.Resolve(poolID, "", ch.KeyRefs())
	if key != "" {
		ch.APIKey = key
	}
	return ch
}

// IsRetryable 上游 5xx / 429 / 连接错误可重试；401 与策略类不重试。
func IsRetryable(err error) bool {
	if err == nil {
		return false
	}
	var up *adaptor.UpstreamError
	if errors.As(err, &up) {
		if up.StatusCode == httpStatusTooManyRequests || up.StatusCode >= 500 {
			return true
		}
		if up.StatusCode == 401 || up.StatusCode == 403 {
			return false
		}
		return false
	}
	if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
		return false
	}
	var netErr net.Error
	if errors.As(err, &netErr) {
		return true
	}
	msg := strings.ToLower(err.Error())
	if strings.Contains(msg, "stream:idle_timeout") || strings.Contains(msg, "stream:buffer_exceeded") {
		return false
	}
	if strings.Contains(msg, "connection refused") || strings.Contains(msg, "timeout") {
		return true
	}
	return false
}

const httpStatusTooManyRequests = 429
