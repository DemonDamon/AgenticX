package provider

import (
	"bufio"
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

	body, err := json.Marshal(upstream)
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

	body, err := json.Marshal(upstream)
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

	streamClient := *p.httpClient
	streamClient.Timeout = 0
	resp, err := streamClient.Do(httpReq)
	if err != nil {
		return fmt.Errorf("upstream request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		preview, _ := io.ReadAll(io.LimitReader(resp.Body, 2048))
		return fmt.Errorf("upstream %d: %s", resp.StatusCode, strings.TrimSpace(string(preview)))
	}

	return parseSSEStream(resp.Body, push)
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

// parseSSEStream 增量解析 OpenAI 兼容的 SSE 流：忽略心跳/注释行，遇到 `data: [DONE]` 即终止。
func parseSSEStream(body io.Reader, push func(openai.StreamChunk) error) error {
	reader := bufio.NewReader(body)
	var eventName string
	var dataLines []string
	flushEvent := func() (bool, error) {
		if len(dataLines) == 0 {
			eventName = ""
			return false, nil
		}
		payload := strings.TrimSpace(strings.Join(dataLines, "\n"))
		event := strings.TrimSpace(eventName)
		eventName = ""
		dataLines = nil
		if payload == "" {
			return false, nil
		}
		if payload == "[DONE]" {
			return true, nil
		}

		var envelope struct {
			Error *struct {
				Message string `json:"message"`
				Code    string `json:"code"`
			} `json:"error"`
		}
		if err := json.Unmarshal([]byte(payload), &envelope); err == nil && envelope.Error != nil {
			message := strings.TrimSpace(envelope.Error.Message)
			if message == "" {
				message = "upstream stream error"
			}
			if code := strings.TrimSpace(envelope.Error.Code); code != "" {
				return false, fmt.Errorf("upstream stream error %s: %s", code, message)
			}
			return false, fmt.Errorf("upstream stream error: %s", message)
		}
		if event == "error" {
			return false, fmt.Errorf("upstream stream error: %s", payload)
		}

		var chunk openai.StreamChunk
		if err := json.Unmarshal([]byte(payload), &chunk); err != nil {
			// 容忍上游偶发的非标准事件（如 keepalive ping），跳过即可。
			return false, nil
		}
		if chunk.ID == "" && chunk.Object == "" && len(chunk.Choices) == 0 {
			return false, nil
		}
		if err := push(chunk); err != nil {
			return false, err
		}
		return false, nil
	}

	for {
		line, readErr := reader.ReadBytes('\n')
		if len(line) > 0 {
			trimmed := bytes.TrimRight(line, "\r\n")
			if len(trimmed) == 0 {
				done, err := flushEvent()
				if err != nil || done {
					return err
				}
				if readErr == io.EOF {
					return nil
				}
				continue
			}
			if bytes.HasPrefix(trimmed, []byte("event:")) {
				eventName = strings.TrimSpace(string(bytes.TrimPrefix(trimmed, []byte("event:"))))
			} else if bytes.HasPrefix(trimmed, []byte("data:")) {
				dataLines = append(dataLines, strings.TrimSpace(string(bytes.TrimPrefix(trimmed, []byte("data:")))))
			}
		}
		if readErr != nil {
			if readErr == io.EOF {
				_, err := flushEvent()
				return err
			}
			return fmt.Errorf("read upstream stream: %w", readErr)
		}
	}
}

func joinURL(base, path string) string {
	return strings.TrimRight(base, "/") + path
}
