package adaptor

import (
	"bufio"
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
	"github.com/agenticx/enterprise/gateway/internal/transform"
)

// ClaudeAdaptor calls Anthropic Messages API and normalizes to pivot.
type ClaudeAdaptor struct {
	httpClient *http.Client
	streamCfg  StreamConfig
}

func NewClaudeAdaptor(opts ...OpenAIOption) *ClaudeAdaptor {
	cfg := StreamConfigFromEnv()
	a := &OpenAIAdaptor{streamCfg: cfg}
	for _, opt := range opts {
		if opt != nil {
			opt(a)
		}
	}
	return &ClaudeAdaptor{
		httpClient: &http.Client{Timeout: 120 * time.Second},
		streamCfg:  a.streamCfg,
	}
}

func (a *ClaudeAdaptor) Name() string { return "claude" }

func (a *ClaudeAdaptor) Complete(ctx context.Context, req openai.ChatCompletionRequest, ch channel.Channel) (openai.ChatCompletionResponse, error) {
	endpoint, apiKey, err := claudePrepare(ch)
	if err != nil {
		return openai.ChatCompletionResponse{}, err
	}
	body, err := json.Marshal(pivotToClaudeRequest(req, ch, false))
	if err != nil {
		return openai.ChatCompletionResponse{}, err
	}
	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, joinURL(endpoint, "/v1/messages"), bytes.NewReader(body))
	if err != nil {
		return openai.ChatCompletionResponse{}, err
	}
	setClaudeHeaders(httpReq, apiKey)
	resp, err := a.httpClient.Do(httpReq)
	if err != nil {
		return openai.ChatCompletionResponse{}, err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		preview, _ := io.ReadAll(io.LimitReader(resp.Body, 2048))
		return openai.ChatCompletionResponse{}, &UpstreamError{StatusCode: resp.StatusCode, Body: strings.TrimSpace(string(preview))}
	}
	var wire claudeMessageResponse
	if err := json.NewDecoder(resp.Body).Decode(&wire); err != nil {
		return openai.ChatCompletionResponse{}, err
	}
	return claudeToPivotResponse(wire, req.Model), nil
}

func (a *ClaudeAdaptor) Stream(ctx context.Context, req openai.ChatCompletionRequest, ch channel.Channel, push StreamPush) error {
	endpoint, apiKey, err := claudePrepare(ch)
	if err != nil {
		return err
	}
	body, err := json.Marshal(pivotToClaudeRequest(req, ch, true))
	if err != nil {
		return err
	}
	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, joinURL(endpoint, "/v1/messages"), bytes.NewReader(body))
	if err != nil {
		return err
	}
	setClaudeHeaders(httpReq, apiKey)
	httpReq.Header.Set("Accept", "text/event-stream")
	streamClient := *a.httpClient
	streamClient.Timeout = 0
	resp, err := streamClient.Do(httpReq)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		preview, _ := io.ReadAll(io.LimitReader(resp.Body, 2048))
		return &UpstreamError{StatusCode: resp.StatusCode, Body: strings.TrimSpace(string(preview))}
	}
	return parseClaudeSSE(resp.Body, req.Model, push)
}

func (a *ClaudeAdaptor) Embeddings(ctx context.Context, req openai.EmbeddingRequest, ch channel.Channel) (openai.EmbeddingResponse, error) {
	_ = ctx
	_ = req
	_ = ch
	return openai.EmbeddingResponse{}, fmt.Errorf("claude: embeddings not supported")
}

type claudeWireRequest struct {
	Model         string                 `json:"model"`
	MaxTokens     int                    `json:"max_tokens"`
	Messages      []map[string]any       `json:"messages"`
	System        any                    `json:"system,omitempty"`
	Temperature   float64                `json:"temperature,omitempty"`
	TopP          float64                `json:"top_p,omitempty"`
	StopSequences []string               `json:"stop_sequences,omitempty"`
	Stream        bool                   `json:"stream,omitempty"`
	Tools         []transform.ClaudeTool `json:"tools,omitempty"`
	Thinking      map[string]any         `json:"thinking,omitempty"`
}

type claudeMessageResponse struct {
	ID      string `json:"id"`
	Model   string `json:"model"`
	Content []struct {
		Type string `json:"type"`
		Text string `json:"text"`
	} `json:"content"`
	Usage struct {
		InputTokens              int `json:"input_tokens"`
		OutputTokens             int `json:"output_tokens"`
		CacheCreationInputTokens int `json:"cache_creation_input_tokens"`
		CacheReadInputTokens     int `json:"cache_read_input_tokens"`
	} `json:"usage"`
}

func pivotToClaudeRequest(req openai.ChatCompletionRequest, ch channel.Channel, stream bool) claudeWireRequest {
	model := modelForChannel(ch, req.Model)
	maxTok := req.MaxTokens
	if maxTok <= 0 {
		maxTok = req.MaxCompletionTokens
	}
	if maxTok <= 0 {
		maxTok = 4096
	}
	out := claudeWireRequest{
		Model:         model,
		MaxTokens:     maxTok,
		Temperature:   req.Temperature,
		TopP:          req.TopP,
		StopSequences: req.Stop,
		Stream:        stream,
		Tools:         transform.OpenAIToolsToClaude(req.Tools),
	}
	out.System = claudeSystemWire(req.System, req.SystemCacheControl)
	if req.ThinkingBudget > 0 || req.ReasoningEffort != "" {
		budget := req.ThinkingBudget
		if budget <= 0 {
			budget = 8192
		}
		out.Thinking = map[string]any{"type": "enabled", "budget_tokens": budget}
	}
	for _, m := range req.Messages {
		if strings.EqualFold(m.Role, "system") {
			if out.System == "" {
				out.System = m.Content
			}
			continue
		}
		content := any(m.Content)
		if len(m.CacheControl) > 0 {
			block := map[string]any{"type": "text", "text": m.Content}
			var cacheCtrl any
			if err := json.Unmarshal(m.CacheControl, &cacheCtrl); err == nil {
				block["cache_control"] = cacheCtrl
			}
			content = []map[string]any{block}
		}
		out.Messages = append(out.Messages, map[string]any{
			"role":    m.Role,
			"content": content,
		})
	}
	return out
}

func claudeToPivotResponse(wire claudeMessageResponse, model string) openai.ChatCompletionResponse {
	text := strings.Builder{}
	for _, block := range wire.Content {
		if block.Type == "text" {
			text.WriteString(block.Text)
		}
	}
	return openai.ChatCompletionResponse{
		ID:      wire.ID,
		Object:  "chat.completion",
		Model:   nonEmpty(wire.Model, model),
		Choices: []openai.ChatCompletionChoice{{Index: 0, Message: openai.ChatMessage{Role: "assistant", Content: text.String()}, FinishReason: "stop"}},
		Usage: openai.Usage{
			PromptTokens:             wire.Usage.InputTokens,
			CompletionTokens:         wire.Usage.OutputTokens,
			TotalTokens:              wire.Usage.InputTokens + wire.Usage.OutputTokens,
			CacheCreationInputTokens: wire.Usage.CacheCreationInputTokens,
			CacheReadInputTokens:     wire.Usage.CacheReadInputTokens,
		},
	}
}

func claudeSystemWire(system string, cacheControl json.RawMessage) any {
	if strings.TrimSpace(system) == "" {
		return nil
	}
	if len(cacheControl) == 0 {
		return system
	}
	block := map[string]any{"type": "text", "text": system}
	var cacheCtrl any
	if err := json.Unmarshal(cacheControl, &cacheCtrl); err == nil {
		block["cache_control"] = cacheCtrl
	}
	return []map[string]any{block}
}

func claudePrepare(ch channel.Channel) (endpoint, apiKey string, err error) {
	endpoint = strings.TrimSpace(ch.BaseURL)
	if endpoint == "" {
		endpoint = "https://api.anthropic.com"
	}
	apiKey = strings.TrimSpace(ch.APIKey)
	if apiKey == "" {
		return "", "", fmt.Errorf("channel missing api key")
	}
	return endpoint, apiKey, nil
}

func setClaudeHeaders(req *http.Request, apiKey string) {
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("x-api-key", apiKey)
	req.Header.Set("anthropic-version", "2023-06-01")
}

func parseClaudeSSE(body io.Reader, model string, push StreamPush) error {
	scanner := bufio.NewScanner(body)
	scanner.Buffer(make([]byte, 0, 64*1024), 16*1024*1024)
	var eventName string
	var dataLines []string
	flush := func() error {
		if len(dataLines) == 0 {
			eventName = ""
			return nil
		}
		payload := strings.TrimSpace(strings.Join(dataLines, "\n"))
		event := strings.TrimSpace(eventName)
		eventName = ""
		dataLines = nil
		if payload == "" {
			return nil
		}
		if event == "content_block_delta" || event == "" {
			var envelope struct {
				Type  string `json:"type"`
				Delta struct {
					Type string `json:"type"`
					Text string `json:"text"`
				} `json:"delta"`
			}
			if err := json.Unmarshal([]byte(payload), &envelope); err == nil {
				if envelope.Delta.Text != "" {
					chunk := openai.StreamChunk{
						Object: "chat.completion.chunk",
						Model:  model,
						Choices: []openai.StreamChoice{{
							Index: 0,
							Delta: openai.StreamDelta{Content: envelope.Delta.Text},
						}},
					}
					return push(chunk)
				}
			}
		}
		if event == "message_stop" {
			return push(openai.StreamChunk{
				Object: "chat.completion.chunk",
				Model:  model,
				Choices: []openai.StreamChoice{{
					Index:        0,
					FinishReason: ptrString("stop"),
				}},
			})
		}
		return nil
	}
	for scanner.Scan() {
		line := scanner.Text()
		if strings.TrimSpace(line) == "" {
			if err := flush(); err != nil {
				return err
			}
			continue
		}
		if strings.HasPrefix(line, "event:") {
			eventName = strings.TrimSpace(strings.TrimPrefix(line, "event:"))
		} else if strings.HasPrefix(line, "data:") {
			dataLines = append(dataLines, strings.TrimSpace(strings.TrimPrefix(line, "data:")))
		}
	}
	if err := flush(); err != nil {
		return err
	}
	return scanner.Err()
}

func ptrString(s string) *string { return &s }
