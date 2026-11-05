package adaptor

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/agenticx/enterprise/gateway/internal/channel"
	"github.com/agenticx/enterprise/gateway/internal/openai"
	"github.com/agenticx/enterprise/gateway/internal/provider"
	"github.com/agenticx/enterprise/gateway/internal/streamio"
)

// StreamConfig keeps the existing adapter options on the shared read contract.
type StreamConfig = streamio.Config

func StreamConfigFromEnv() StreamConfig { return streamio.ConfigFromEnv() }

// OpenAIAdaptor OpenAI 兼容上游调用。
type OpenAIAdaptor struct {
	httpClient   *http.Client
	streamCfg    StreamConfig
	resolveExtra func(channel.Channel) string
}

type OpenAIOption func(*OpenAIAdaptor)

func WithStreamConfig(cfg StreamConfig) OpenAIOption {
	return func(a *OpenAIAdaptor) { a.streamCfg = cfg }
}

func NewOpenAIAdaptor(opts ...OpenAIOption) *OpenAIAdaptor {
	a := &OpenAIAdaptor{
		httpClient: &http.Client{Timeout: 60 * time.Second},
		streamCfg:  StreamConfigFromEnv(),
		resolveExtra: func(ch channel.Channel) string {
			return strings.TrimSpace(ch.APIKey)
		},
	}
	for _, opt := range opts {
		if opt != nil {
			opt(a)
		}
	}
	return a
}

func (a *OpenAIAdaptor) Name() string { return "openai" }

func (a *OpenAIAdaptor) apiKey(ch channel.Channel) string {
	if k := strings.TrimSpace(ch.APIKey); k != "" {
		return k
	}
	if a.resolveExtra != nil {
		return strings.TrimSpace(a.resolveExtra(ch))
	}
	return provider.DefaultKeyFromEnv(ch.ProviderLabel)
}

func (a *OpenAIAdaptor) Complete(
	ctx context.Context,
	req openai.ChatCompletionRequest,
	ch channel.Channel,
) (openai.ChatCompletionResponse, error) {
	endpoint, apiKey, err := a.prepare(ch)
	if err != nil {
		return openai.ChatCompletionResponse{}, err
	}
	upstream := req
	upstream.Stream = false
	if strings.TrimSpace(upstream.Model) == "" {
		upstream.Model = modelForChannel(ch, req.Model)
	}
	body, err := json.Marshal(openai.CompatibleRequest(upstream))
	if err != nil {
		return openai.ChatCompletionResponse{}, fmt.Errorf("marshal upstream request: %w", err)
	}
	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, joinURL(endpoint, "/chat/completions"), bytes.NewReader(body))
	if err != nil {
		return openai.ChatCompletionResponse{}, fmt.Errorf("build upstream request: %w", err)
	}
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("Accept", "application/json")
	httpReq.Header.Set("Authorization", "Bearer "+apiKey)
	resp, err := a.httpClient.Do(httpReq)
	if err != nil {
		return openai.ChatCompletionResponse{}, fmt.Errorf("upstream request failed: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		preview, _ := io.ReadAll(io.LimitReader(resp.Body, 2048))
		return openai.ChatCompletionResponse{}, &UpstreamError{StatusCode: resp.StatusCode, Body: strings.TrimSpace(string(preview))}
	}
	var decoded openai.ChatCompletionResponse
	if err := json.NewDecoder(resp.Body).Decode(&decoded); err != nil {
		return openai.ChatCompletionResponse{}, fmt.Errorf("decode upstream response: %w", err)
	}
	if strings.TrimSpace(decoded.Model) == "" {
		decoded.Model = nonEmpty(modelForChannel(ch, req.Model), req.Model)
	}
	return decoded, nil
}

func (a *OpenAIAdaptor) Stream(
	ctx context.Context,
	req openai.ChatCompletionRequest,
	ch channel.Channel,
	push StreamPush,
) error {
	endpoint, apiKey, err := a.prepare(ch)
	if err != nil {
		return err
	}
	upstream := req
	upstream.Stream = true
	if strings.TrimSpace(upstream.Model) == "" {
		upstream.Model = modelForChannel(ch, req.Model)
	}
	body, err := json.Marshal(openai.CompatibleRequest(upstream))
	if err != nil {
		return fmt.Errorf("marshal upstream request: %w", err)
	}
	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, joinURL(endpoint, "/chat/completions"), bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("build upstream request: %w", err)
	}
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("Accept", "text/event-stream")
	httpReq.Header.Set("Authorization", "Bearer "+apiKey)
	resp, err := streamio.DoStream(a.httpClient, httpReq, a.streamCfg)
	if err != nil {
		return fmt.Errorf("upstream request failed: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		preview, _ := io.ReadAll(io.LimitReader(resp.Body, 2048))
		return &UpstreamError{StatusCode: resp.StatusCode, Body: strings.TrimSpace(string(preview))}
	}
	return openai.ReadSSE(ctx, resp.Body, a.streamCfg, push)
}

func (a *OpenAIAdaptor) Embeddings(
	ctx context.Context,
	req openai.EmbeddingRequest,
	ch channel.Channel,
) (openai.EmbeddingResponse, error) {
	endpoint, apiKey, err := a.prepare(ch)
	if err != nil {
		return openai.EmbeddingResponse{}, err
	}
	if strings.TrimSpace(req.Model) == "" {
		req.Model = modelForChannel(ch, req.Model)
	}
	body, err := json.Marshal(req)
	if err != nil {
		return openai.EmbeddingResponse{}, fmt.Errorf("marshal embedding request: %w", err)
	}
	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, joinURL(endpoint, "/embeddings"), bytes.NewReader(body))
	if err != nil {
		return openai.EmbeddingResponse{}, fmt.Errorf("build embedding request: %w", err)
	}
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("Accept", "application/json")
	httpReq.Header.Set("Authorization", "Bearer "+apiKey)
	resp, err := a.httpClient.Do(httpReq)
	if err != nil {
		return openai.EmbeddingResponse{}, fmt.Errorf("embedding upstream request failed: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		preview, _ := io.ReadAll(io.LimitReader(resp.Body, 2048))
		return openai.EmbeddingResponse{}, &UpstreamError{StatusCode: resp.StatusCode, Body: strings.TrimSpace(string(preview))}
	}
	var decoded openai.EmbeddingResponse
	if err := json.NewDecoder(resp.Body).Decode(&decoded); err != nil {
		return openai.EmbeddingResponse{}, fmt.Errorf("decode embedding response: %w", err)
	}
	if strings.TrimSpace(decoded.Model) == "" {
		decoded.Model = nonEmpty(modelForChannel(ch, req.Model), req.Model)
	}
	return decoded, nil
}

func (a *OpenAIAdaptor) prepare(ch channel.Channel) (endpoint, apiKey string, err error) {
	endpoint = strings.TrimSpace(ch.BaseURL)
	if endpoint == "" {
		return "", "", fmt.Errorf("channel missing base_url")
	}
	apiKey = a.apiKey(ch)
	if apiKey == "" {
		return "", "", fmt.Errorf("channel missing api key")
	}
	return endpoint, apiKey, nil
}

// UpstreamError 携带 HTTP 状态，供 retry 判定。
type UpstreamError struct {
	StatusCode int
	Body       string
}

func (e *UpstreamError) Error() string {
	if e == nil {
		return "upstream error"
	}
	return fmt.Sprintf("upstream %d: %s", e.StatusCode, e.Body)
}

func parseSSEStream(body io.Reader, cfg StreamConfig, push StreamPush) error {
	return openai.ReadSSE(context.Background(), body, cfg, push)
}

func joinURL(base, path string) string {
	return strings.TrimRight(base, "/") + path
}

func nonEmpty(a, fallback string) string {
	if strings.TrimSpace(a) != "" {
		return a
	}
	return fallback
}

func modelForChannel(ch channel.Channel, requested string) string {
	if ch.Metadata != nil {
		if v, ok := ch.Metadata["modelName"].(string); ok && strings.TrimSpace(v) != "" {
			return strings.TrimSpace(v)
		}
	}
	return requested
}
