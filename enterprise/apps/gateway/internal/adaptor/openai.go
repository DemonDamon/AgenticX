package adaptor

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/agenticx/enterprise/gateway/internal/channel"
	"github.com/agenticx/enterprise/gateway/internal/openai"
	"github.com/agenticx/enterprise/gateway/internal/provider"
)

// StreamConfig 流式加固参数（FR-6）。
type StreamConfig struct {
	IdleTimeout       time.Duration
	ScannerMaxBufferB int64
}

func StreamConfigFromEnv() StreamConfig {
	cfg := StreamConfig{
		IdleTimeout:       60 * time.Second,
		ScannerMaxBufferB: 16 * 1024 * 1024,
	}
	if v := strings.TrimSpace(os.Getenv("GATEWAY_STREAM_IDLE_TIMEOUT")); v != "" {
		if sec, err := strconv.Atoi(v); err == nil && sec > 0 {
			cfg.IdleTimeout = time.Duration(sec) * time.Second
		}
	}
	if v := strings.TrimSpace(os.Getenv("GATEWAY_STREAM_SCANNER_MAX_BUFFER_MB")); v != "" {
		if mb, err := strconv.Atoi(v); err == nil && mb > 0 {
			cfg.ScannerMaxBufferB = int64(mb) * 1024 * 1024
		}
	}
	return cfg
}

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
	streamClient := *a.httpClient
	streamClient.Timeout = 0
	resp, err := streamClient.Do(httpReq)
	if err != nil {
		return fmt.Errorf("upstream request failed: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		preview, _ := io.ReadAll(io.LimitReader(resp.Body, 2048))
		return &UpstreamError{StatusCode: resp.StatusCode, Body: strings.TrimSpace(string(preview))}
	}
	return parseSSEStream(resp.Body, a.streamCfg, push)
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
	idle := cfg.IdleTimeout
	if idle <= 0 {
		idle = 60 * time.Second
	}
	maxBuf := cfg.ScannerMaxBufferB
	if maxBuf <= 0 {
		maxBuf = 16 * 1024 * 1024
	}
	reader := bufio.NewReader(body)
	var eventName string
	var dataLines []string
	var totalBytes int64

	type readResult struct {
		line []byte
		err  error
	}
	readCh := make(chan readResult, 1)
	pendingRead := false
	readOne := func() (readResult, error) {
		if !pendingRead {
			pendingRead = true
			go func() {
				line, err := reader.ReadBytes('\n')
				readCh <- readResult{line: line, err: err}
			}()
		}
		select {
		case res := <-readCh:
			pendingRead = false
			return res, nil
		case <-time.After(idle):
			return readResult{}, fmt.Errorf("stream:idle_timeout")
		}
	}

	flushEvent := func() (bool, error) {
		if len(dataLines) == 0 {
			eventName = ""
			return false, nil
		}
		payload := strings.TrimSpace(strings.Join(dataLines, "\n"))
		event := strings.TrimSpace(eventName)
		eventName = ""
		dataLines = nil
		totalBytes += int64(len(payload))
		if totalBytes > maxBuf {
			return false, fmt.Errorf("stream:buffer_exceeded")
		}
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
		res, idleErr := readOne()
		if idleErr != nil {
			return idleErr
		}
		line := res.line
		readErr := res.err
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
