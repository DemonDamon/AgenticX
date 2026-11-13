package relay

import (
	"bytes"
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
	"github.com/agenticx/enterprise/gateway/internal/virtualmodel"
)

const defaultMaxRetries = 2

// Executor 负责 Channel 选择、Key 解析、Adaptor 调用与失败重试。
type Executor struct {
	picker   *channel.Picker
	factory  *adaptor.Factory
	keypool  *keypool.Pool
	cooldown time.Duration
	virtual  VirtualPlanner
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
	Response      openai.ChatCompletionResponse
	Channel       channel.Channel
	KeyRef        string
	Attempts      []channel.Attempt
	PickDecision  channel.PickDecision
	ResolvedModel string
	VirtualName   string
}

type StreamResult struct {
	Channel       channel.Channel
	KeyRef        string
	Attempts      []channel.Attempt
	PickDecision  channel.PickDecision
	ResolvedModel string
	VirtualName   string
}

// VirtualPlanner resolves a virtual model name before channel selection.
// ok is false for ordinary model names.
type VirtualPlanner interface {
	Plan(tenantID, name string, available func(model string) bool) (order []string, virtualName string, ok bool)
}

func (e *Executor) SetVirtualPlanner(p VirtualPlanner) {
	if e == nil {
		return
	}
	e.virtual = p
}

func (e *Executor) virtualPlan(model string, id channel.Identity) ([]string, string, bool) {
	if e == nil || e.virtual == nil {
		return nil, "", false
	}
	return e.virtual.Plan(id.TenantID, model, func(target string) bool {
		if e.picker == nil {
			return false
		}
		return e.picker.HasRoutableChannel(id.TenantID, target)
	})
}

func (e *Executor) Complete(
	ctx context.Context,
	req openai.ChatCompletionRequest,
	model string,
	id channel.Identity,
) (CompleteResult, error) {
	if order, virtualName, ok := virtualmodel.PlanFromContext(ctx); ok {
		return e.completeVirtual(ctx, req, order, virtualName, id)
	}
	if order, virtualName, ok := e.virtualPlan(model, id); ok {
		return e.completeVirtual(ctx, req, order, virtualName, id)
	}
	return e.completeOne(ctx, req, model, id)
}

func (e *Executor) completeVirtual(
	ctx context.Context,
	req openai.ChatCompletionRequest,
	order []string,
	virtualName string,
	id channel.Identity,
) (CompleteResult, error) {
	var lastErr error
	attempts := make([]channel.Attempt, 0)
	for i, target := range order {
		reqTry := req
		reqTry.Model = target
		result, err := e.completeOne(ctx, reqTry, target, id)
		attempts = append(attempts, result.Attempts...)
		result.Attempts = attempts
		result.ResolvedModel = target
		result.VirtualName = virtualName
		if err == nil || !isNoChannel(err) || i == len(order)-1 {
			return result, err
		}
		lastErr = err
	}
	return CompleteResult{Attempts: attempts, VirtualName: virtualName}, lastErr
}

func (e *Executor) completeOne(
	ctx context.Context,
	req openai.ChatCompletionRequest,
	model string,
	id channel.Identity,
) (CompleteResult, error) {
	var lastErr error
	excludeChannels := map[string]struct{}{}
	attempts := make([]channel.Attempt, 0)
	maxRetries := defaultMaxRetries

	for attempt := 0; attempt <= maxRetries; attempt++ {
		ch, pick, ok := e.picker.PickWithPrefix(model, id, excludeChannels, req.Messages)
		if !ok {
			if lastErr != nil {
				return CompleteResult{Attempts: attempts}, lastErr
			}
			return CompleteResult{Attempts: attempts}, fmt.Errorf("no channel for model %s", model)
		}
		if ch.MaxRetries > 0 {
			maxRetries = ch.MaxRetries
		}

		result, err := e.completeOnChannel(ctx, req, ch)
		attempts = append(attempts, result.attempts...)
		if err == nil {
			e.picker.MarkSuccess(id, model, ch, result.latencyMS)
			return CompleteResult{
				Response:     result.response,
				Channel:      ch,
				KeyRef:       result.keyRef,
				Attempts:     attempts,
				PickDecision: pick,
			}, nil
		}
		lastErr = err
		if !IsChannelRetryable(err) {
			return CompleteResult{Attempts: attempts, Channel: ch, KeyRef: result.keyRef}, err
		}
		e.picker.MarkFailure(ch, err.Error(), e.cooldown)
		excludeChannels[ch.ID] = struct{}{}
	}
	return CompleteResult{Attempts: attempts}, lastErr
}

type channelCompleteOutcome struct {
	response  openai.ChatCompletionResponse
	keyRef    string
	latencyMS int64
	attempts  []channel.Attempt
}

func (e *Executor) completeOnChannel(
	ctx context.Context,
	req openai.ChatCompletionRequest,
	ch channel.Channel,
) (channelCompleteOutcome, error) {
	poolID := poolIDForChannel(ch)
	refs := ch.KeyRefs()
	maxKeyTries := maxKeyAttempts(ch)
	excludeKeys := map[string]struct{}{}
	var lastErr error
	var lastKeyRef string

	for keyTry := 0; keyTry < maxKeyTries; keyTry++ {
		resolved := e.resolveKeyWithExcludes(ch, poolID, excludeKeys)
		lastKeyRef = resolved.KeyRef
		if resolved.Key == "" && len(refs) > 0 {
			lastErr = fmt.Errorf("no available key in channel %s", ch.ID)
			break
		}
		chTry := ch
		chTry.APIKey = resolved.Key

		start := time.Now()
		ad, err := e.factory.For(chTry)
		if err != nil {
			return channelCompleteOutcome{}, err
		}
		resp, err := ad.Complete(ctx, req, chTry)
		latency := time.Since(start).Milliseconds()
		if err == nil {
			if resolved.KeyRef != "" && resolved.KeyRef != "direct" {
				e.keypool.MarkSuccess(poolID, resolved.KeyRef)
			}
			return channelCompleteOutcome{
				response:  resp,
				keyRef:    resolved.KeyRef,
				latencyMS: latency,
				attempts: []channel.Attempt{{
					ChannelID: ch.ID,
					Provider:  ch.ProviderLabel,
					Success:   true,
					LatencyMS: latency,
				}},
			}, nil
		}
		lastErr = err
		reason := err.Error()
		attempt := channel.Attempt{
			ChannelID:   ch.ID,
			Provider:    ch.ProviderLabel,
			Success:     false,
			RetryReason: reason,
			LatencyMS:   latency,
		}
		if IsKeyRetryable(err) && len(refs) > 0 && resolved.KeyRef != "" && resolved.KeyRef != "direct" {
			e.keypool.MarkFailure(poolID, resolved.KeyRef, reason)
			excludeKeys[resolved.KeyRef] = struct{}{}
			if keyTry+1 < maxKeyTries {
				continue
			}
		}
		return channelCompleteOutcome{
			keyRef:   lastKeyRef,
			attempts: []channel.Attempt{attempt},
		}, err
	}
	return channelCompleteOutcome{keyRef: lastKeyRef}, lastErr
}

func (e *Executor) Stream(
	ctx context.Context,
	req openai.ChatCompletionRequest,
	model string,
	id channel.Identity,
	push adaptor.StreamPush,
) (StreamResult, error) {
	if order, virtualName, ok := virtualmodel.PlanFromContext(ctx); ok {
		return e.streamVirtual(ctx, req, order, virtualName, id, push)
	}
	if order, virtualName, ok := e.virtualPlan(model, id); ok {
		return e.streamVirtual(ctx, req, order, virtualName, id, push)
	}
	return e.streamOne(ctx, req, model, id, push)
}

func (e *Executor) streamVirtual(
	ctx context.Context,
	req openai.ChatCompletionRequest,
	order []string,
	virtualName string,
	id channel.Identity,
	push adaptor.StreamPush,
) (StreamResult, error) {
	var lastErr error
	attempts := make([]channel.Attempt, 0)
	for i, target := range order {
		reqTry := req
		reqTry.Model = target
		result, err := e.streamOne(ctx, reqTry, target, id, push)
		attempts = append(attempts, result.Attempts...)
		result.Attempts = attempts
		result.ResolvedModel = target
		result.VirtualName = virtualName
		if err == nil || !isNoChannel(err) || i == len(order)-1 {
			return result, err
		}
		lastErr = err
	}
	return StreamResult{Attempts: attempts, VirtualName: virtualName}, lastErr
}

func isNoChannel(err error) bool {
	return err != nil && strings.HasPrefix(err.Error(), "no channel for model ")
}

func (e *Executor) streamOne(
	ctx context.Context,
	req openai.ChatCompletionRequest,
	model string,
	id channel.Identity,
	push adaptor.StreamPush,
) (StreamResult, error) {
	var lastErr error
	excludeChannels := map[string]struct{}{}
	attempts := make([]channel.Attempt, 0)
	maxRetries := defaultMaxRetries

	for attempt := 0; attempt <= maxRetries; attempt++ {
		ch, pick, ok := e.picker.PickWithPrefix(model, id, excludeChannels, req.Messages)
		if !ok {
			if lastErr != nil {
				return StreamResult{Attempts: attempts}, lastErr
			}
			return StreamResult{Attempts: attempts}, fmt.Errorf("no channel for model %s", model)
		}
		if ch.MaxRetries > 0 {
			maxRetries = ch.MaxRetries
		}

		result, err := e.streamOnChannel(ctx, req, ch, push)
		attempts = append(attempts, result.attempts...)
		if err == nil {
			e.picker.MarkSuccess(id, model, ch, result.latencyMS)
			return StreamResult{Channel: ch, KeyRef: result.keyRef, Attempts: attempts, PickDecision: pick}, nil
		}
		lastErr = err
		if !IsChannelRetryable(err) {
			return StreamResult{Attempts: attempts, Channel: ch, KeyRef: result.keyRef}, err
		}
		e.picker.MarkFailure(ch, err.Error(), e.cooldown)
		if result.committed {
			return StreamResult{Attempts: attempts, Channel: ch, KeyRef: result.keyRef}, err
		}
		excludeChannels[ch.ID] = struct{}{}
	}
	return StreamResult{Attempts: attempts}, lastErr
}

type channelStreamOutcome struct {
	keyRef    string
	latencyMS int64
	attempts  []channel.Attempt
	committed bool
}

func (e *Executor) streamOnChannel(
	ctx context.Context,
	req openai.ChatCompletionRequest,
	ch channel.Channel,
	push adaptor.StreamPush,
) (channelStreamOutcome, error) {
	poolID := poolIDForChannel(ch)
	refs := ch.KeyRefs()
	maxKeyTries := maxKeyAttempts(ch)
	excludeKeys := map[string]struct{}{}
	var lastErr error
	var lastKeyRef string
	var committed bool

	for keyTry := 0; keyTry < maxKeyTries; keyTry++ {
		committed = false
		resolved := e.resolveKeyWithExcludes(ch, poolID, excludeKeys)
		lastKeyRef = resolved.KeyRef
		if resolved.Key == "" && len(refs) > 0 {
			lastErr = fmt.Errorf("no available key in channel %s", ch.ID)
			break
		}
		chTry := ch
		chTry.APIKey = resolved.Key

		wrappedPush := func(chunk openai.StreamChunk) error {
			if err := push(chunk); err != nil {
				return &clientPushError{err: err}
			}
			if len(chunk.Choices) > 0 && deltaHasClientPayload(chunk.Choices[0].Delta) {
				committed = true
			}
			return nil
		}

		start := time.Now()
		ad, err := e.factory.For(chTry)
		if err != nil {
			return channelStreamOutcome{committed: committed}, err
		}
		err = ad.Stream(ctx, req, chTry, wrappedPush)
		latency := time.Since(start).Milliseconds()
		if err == nil {
			if resolved.KeyRef != "" && resolved.KeyRef != "direct" {
				e.keypool.MarkSuccess(poolID, resolved.KeyRef)
			}
			return channelStreamOutcome{
				keyRef:    resolved.KeyRef,
				latencyMS: latency,
				committed: committed,
				attempts: []channel.Attempt{{
					ChannelID: ch.ID,
					Provider:  ch.ProviderLabel,
					Success:   true,
					LatencyMS: latency,
				}},
			}, nil
		}
		lastErr = err
		reason := err.Error()
		attempt := channel.Attempt{
			ChannelID:   ch.ID,
			Provider:    ch.ProviderLabel,
			Success:     false,
			RetryReason: reason,
			LatencyMS:   latency,
		}
		canRetryKey := IsKeyRetryable(err) && len(refs) > 0 && resolved.KeyRef != "" && resolved.KeyRef != "direct" && !committed
		if canRetryKey {
			e.keypool.MarkFailure(poolID, resolved.KeyRef, reason)
			excludeKeys[resolved.KeyRef] = struct{}{}
			if keyTry+1 < maxKeyTries {
				continue
			}
		}
		return channelStreamOutcome{keyRef: lastKeyRef, attempts: []channel.Attempt{attempt}, committed: committed}, err
	}
	return channelStreamOutcome{keyRef: lastKeyRef, committed: committed}, lastErr
}

func (e *Executor) resolveKeyWithExcludes(ch channel.Channel, poolID string, exclude map[string]struct{}) keypool.ResolveResult {
	if strings.TrimSpace(ch.APIKey) != "" {
		return keypool.ResolveResult{Key: ch.APIKey, KeyRef: "direct"}
	}
	return e.keypool.ResolveWithRef(poolID, "", ch.KeyRefs(), exclude)
}

func poolIDForChannel(ch channel.Channel) string {
	poolID := ch.KeyPoolID()
	if poolID == "" {
		poolID = ch.ID
	}
	return poolID
}

func maxKeyAttempts(ch channel.Channel) int {
	refs := ch.KeyRefs()
	if len(refs) == 0 {
		return 1
	}
	return len(refs)
}

// IsKeyRetryable upstream errors that should try the next key within the same channel.
func IsKeyRetryable(err error) bool {
	if err == nil {
		return false
	}
	var pushErr *clientPushError
	if errors.As(err, &pushErr) {
		return false
	}
	var up *adaptor.UpstreamError
	if errors.As(err, &up) {
		switch up.StatusCode {
		case 401, 403, 429:
			return true
		default:
			return up.StatusCode >= 500
		}
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

// IsChannelRetryable upstream errors that should try another channel.
func IsChannelRetryable(err error) bool {
	if err == nil {
		return false
	}
	var pushErr *clientPushError
	if errors.As(err, &pushErr) {
		return false
	}
	var up *adaptor.UpstreamError
	if errors.As(err, &up) {
		if up.StatusCode == httpStatusTooManyRequests || up.StatusCode >= 500 {
			return true
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

// IsRetryable kept for backward-compatible tests (channel-level retry).
func IsRetryable(err error) bool {
	return IsChannelRetryable(err)
}

type clientPushError struct {
	err error
}

func (e *clientPushError) Error() string {
	if e == nil || e.err == nil {
		return "client push failed"
	}
	return e.err.Error()
}

func (e *clientPushError) Unwrap() error {
	if e == nil {
		return nil
	}
	return e.err
}

func deltaHasClientPayload(delta openai.StreamDelta) bool {
	if strings.TrimSpace(delta.Content) != "" || strings.TrimSpace(delta.ReasoningContent) != "" {
		return true
	}
	raw := bytes.TrimSpace(delta.ToolCalls)
	return len(raw) > 0 && string(raw) != "null"
}

const httpStatusTooManyRequests = 429
