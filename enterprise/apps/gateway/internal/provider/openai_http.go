package provider

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/agenticx/enterprise/gateway/internal/openai"
	"github.com/agenticx/enterprise/gateway/internal/routing"
	"github.com/agenticx/enterprise/gateway/internal/streamio"
)

// APIKeyResolver 根据 provider 名称解析 API Key（典型来源：进程环境变量、Secret Store）。
// 返回空字符串视为未配置，会触发 fallback 兜底。
type APIKeyResolver func(providerName string) string

// OpenAICompatibleProvider 通过标准 OpenAI 兼容协议向上游模型服务发起 HTTPS 请求，
// 同时持有一个可选的 fallback（默认是 MockProvider）：当 Endpoint 缺失或 Key 未配置时自动回退，
// 让本地开发与生产环境共享同一份代码路径。
type OpenAICompatibleProvider struct {
	httpClient *http.Client
	resolveKey APIKeyResolver
	fallback   ChatProvider
}

// Option 用函数选项模式注入测试 / 自定义依赖。
type Option func(*OpenAICompatibleProvider)

func WithHTTPClient(client *http.Client) Option {
	return func(p *OpenAICompatibleProvider) {
		if client != nil {
			p.httpClient = client
		}
	}
}

func WithKeyResolver(resolver APIKeyResolver) Option {
	return func(p *OpenAICompatibleProvider) {
		if resolver != nil {
			p.resolveKey = resolver
		}
	}
}

func WithFallback(fallback ChatProvider) Option {
	return func(p *OpenAICompatibleProvider) {
		if fallback != nil {
			p.fallback = fallback
		}
	}
}

func newOpenAIHTTPProvider(opts ...Option) *OpenAICompatibleProvider {
	p := &OpenAICompatibleProvider{
		httpClient: &http.Client{Timeout: 60 * time.Second},
		resolveKey: DefaultKeyFromEnv,
		fallback:   NewMockProvider(),
	}
	for _, opt := range opts {
		opt(p)
	}
	return p
}

// DefaultKeyFromEnv 默认 Key 解析策略：
//
//  1. `<PROVIDER>_API_KEY`（provider 名转大写、连字符替换为下划线，如 deepseek -> DEEPSEEK_API_KEY）；
//  2. 通用兜底 `LLM_API_KEY`（适合自托管 OpenAI 兼容网关）。
//
// 仅在以上两步都失败时返回空字符串，调用方据此回退 mock。
func DefaultKeyFromEnv(providerName string) string {
	name := strings.TrimSpace(providerName)
	if name != "" {
		envKey := strings.ReplaceAll(strings.ToUpper(name), "-", "_") + "_API_KEY"
		if v := strings.TrimSpace(os.Getenv(envKey)); v != "" {
			return v
		}
	}
	if v := strings.TrimSpace(os.Getenv("LLM_API_KEY")); v != "" {
		return v
	}
	return ""
}

func (p *OpenAICompatibleProvider) shouldFallback(decision routing.Decision) (string, string, bool) {
	endpoint := strings.TrimSpace(decision.Endpoint)
	if endpoint == "" {
		return "", "", true
	}
	// admin-console 落盘的 Decision.APIKey 优先；缺省时回退环境变量解析。
	apiKey := strings.TrimSpace(decision.APIKey)
	if apiKey == "" {
		apiKey = p.resolveKey(decision.Provider)
	}
	if apiKey == "" {
		return "", "", true
	}
	return endpoint, apiKey, false
}

func (p *OpenAICompatibleProvider) Complete(
	ctx context.Context,
	req openai.ChatCompletionRequest,
	decision routing.Decision,
) (openai.ChatCompletionResponse, error) {
	endpoint, apiKey, fallback := p.shouldFallback(decision)
	if fallback {
		return p.fallback.Complete(ctx, req, decision)
	}

	upstream := req
	upstream.Stream = false
	if strings.TrimSpace(upstream.Model) == "" {
		upstream.Model = decision.Model
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

	resp, err := p.httpClient.Do(httpReq)
	if err != nil {
		return openai.ChatCompletionResponse{}, fmt.Errorf("upstream request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		preview, _ := io.ReadAll(io.LimitReader(resp.Body, 2048))
		return openai.ChatCompletionResponse{}, fmt.Errorf("upstream %d: %s", resp.StatusCode, strings.TrimSpace(string(preview)))
	}

	var decoded openai.ChatCompletionResponse
	if err := json.NewDecoder(resp.Body).Decode(&decoded); err != nil {
		return openai.ChatCompletionResponse{}, fmt.Errorf("decode upstream response: %w", err)
	}
	if strings.TrimSpace(decoded.Model) == "" {
		decoded.Model = nonEmpty(decision.Model, req.Model)
	}
	return decoded, nil
}

func (p *OpenAICompatibleProvider) Stream(
	ctx context.Context,
	req openai.ChatCompletionRequest,
	decision routing.Decision,
	push func(openai.StreamChunk) error,
) error {
	endpoint, apiKey, fallback := p.shouldFallback(decision)
	if fallback {
		return p.fallback.Stream(ctx, req, decision, push)
	}

	upstream := req
	upstream.Stream = true
	if strings.TrimSpace(upstream.Model) == "" {
		upstream.Model = decision.Model
	}

	body, err := json.Marshal(openai.CompatibleRequest(upstream))
	if err != nil {
		return fmt.Errorf("marshal upstream request: %w", err)
	}

	var lastErr error
	for attempt := 0; attempt < 2; attempt++ {
		if err := ctx.Err(); err != nil {
			return err
		}
		httpReq, err := http.NewRequestWithContext(
			ctx,
			http.MethodPost,
			joinURL(endpoint, "/chat/completions"),
			bytes.NewReader(body),
		)
		if err != nil {
			return fmt.Errorf("build upstream request: %w", err)
		}
		httpReq.Header.Set("Content-Type", "application/json")
		httpReq.Header.Set("Accept", "text/event-stream")
		httpReq.Header.Set("Authorization", "Bearer "+apiKey)

		resp, err := streamio.DoStream(p.httpClient, httpReq, streamio.ConfigFromEnv())
		if err != nil {
			lastErr = fmt.Errorf("upstream request failed: %w", err)
		} else {
			pushed := false
			if resp.StatusCode >= 400 {
				preview, _ := io.ReadAll(io.LimitReader(resp.Body, 2048))
				lastErr = fmt.Errorf("upstream %d: %s", resp.StatusCode, strings.TrimSpace(string(preview)))
			} else {
				lastErr = openai.ReadSSE(ctx, resp.Body, streamio.ConfigFromEnv(), func(chunk openai.StreamChunk) error {
					pushed = true
					return push(chunk)
				})
			}
			_ = resp.Body.Close()
			if lastErr == nil {
				return nil
			}
			// Never replay after any chunk reached the client: that would duplicate output.
			if pushed {
				return lastErr
			}
		}
		if attempt == 0 && isRetryableInitialStreamError(lastErr) {
			timer := time.NewTimer(150 * time.Millisecond)
			select {
			case <-ctx.Done():
				timer.Stop()
				return ctx.Err()
			case <-timer.C:
			}
			continue
		}
		return lastErr
	}
	return lastErr
}

func isRetryableInitialStreamError(err error) bool {
	if err == nil {
		return false
	}
	msg := strings.ToLower(err.Error())
	return strings.Contains(msg, "network error") ||
		strings.Contains(msg, "connection reset") ||
		strings.Contains(msg, "connection refused") ||
		strings.Contains(msg, "socket hang up") ||
		strings.Contains(msg, "unexpected eof") ||
		strings.Contains(msg, "timeout") ||
		strings.Contains(msg, "upstream 429") ||
		strings.Contains(msg, "upstream 500") ||
		strings.Contains(msg, "upstream 502") ||
		strings.Contains(msg, "upstream 503") ||
		strings.Contains(msg, "upstream 504")
}

func streamIdleTimeoutFromEnv() time.Duration {
	return streamio.ConfigFromEnv().IdleTimeout
}

func (p *OpenAICompatibleProvider) Embeddings(
	ctx context.Context,
	req openai.EmbeddingRequest,
	decision routing.Decision,
) (openai.EmbeddingResponse, error) {
	endpoint, apiKey, fallback := p.shouldFallback(decision)
	if fallback {
		return p.fallback.Embeddings(ctx, req, decision)
	}
	if strings.TrimSpace(req.Model) == "" {
		req.Model = decision.Model
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
	resp, err := p.httpClient.Do(httpReq)
	if err != nil {
		return openai.EmbeddingResponse{}, fmt.Errorf("embedding upstream request failed: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		preview, _ := io.ReadAll(io.LimitReader(resp.Body, 2048))
		return openai.EmbeddingResponse{}, fmt.Errorf("embedding upstream %d: %s", resp.StatusCode, strings.TrimSpace(string(preview)))
	}
	var decoded openai.EmbeddingResponse
	if err := json.NewDecoder(resp.Body).Decode(&decoded); err != nil {
		return openai.EmbeddingResponse{}, fmt.Errorf("decode embedding response: %w", err)
	}
	if strings.TrimSpace(decoded.Model) == "" {
		decoded.Model = nonEmpty(decision.Model, req.Model)
	}
	return decoded, nil
}

// parseSSEStream is retained for package callers; network requests pass their
// context directly to the shared decoder so cancellation interrupts body reads.
func parseSSEStream(body io.Reader, idle time.Duration, push func(openai.StreamChunk) error) error {
	cfg := streamio.ConfigFromEnv()
	cfg.IdleTimeout = idle
	return openai.ReadSSE(context.Background(), body, cfg, push)
}

func joinURL(base, path string) string {
	return strings.TrimRight(base, "/") + path
}
