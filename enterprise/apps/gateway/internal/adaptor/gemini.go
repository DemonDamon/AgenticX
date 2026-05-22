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

// GeminiAdaptor calls Google Gemini generateContent API and normalizes to pivot.
type GeminiAdaptor struct {
	httpClient *http.Client
	streamCfg  StreamConfig
}

func NewGeminiAdaptor(opts ...OpenAIOption) *GeminiAdaptor {
	cfg := StreamConfigFromEnv()
	a := &OpenAIAdaptor{streamCfg: cfg}
	for _, opt := range opts {
		if opt != nil {
			opt(a)
		}
	}
	return &GeminiAdaptor{
		httpClient: &http.Client{Timeout: 120 * time.Second},
		streamCfg:  a.streamCfg,
	}
}

func (a *GeminiAdaptor) Name() string { return "gemini" }

func (a *GeminiAdaptor) Complete(ctx context.Context, req openai.ChatCompletionRequest, ch channel.Channel) (openai.ChatCompletionResponse, error) {
	endpoint, apiKey, err := geminiPrepare(ch)
	if err != nil {
		return openai.ChatCompletionResponse{}, err
	}
	model := modelForChannel(ch, req.Model)
	url := fmt.Sprintf("%s/v1beta/models/%s:generateContent", strings.TrimRight(endpoint, "/"), model)
	body, err := json.Marshal(pivotToGeminiRequest(req))
	if err != nil {
		return openai.ChatCompletionResponse{}, err
	}
	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		return openai.ChatCompletionResponse{}, err
	}
	setGeminiHeaders(httpReq, apiKey)
	resp, err := a.httpClient.Do(httpReq)
	if err != nil {
		return openai.ChatCompletionResponse{}, err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		preview, _ := io.ReadAll(io.LimitReader(resp.Body, 2048))
		return openai.ChatCompletionResponse{}, &UpstreamError{StatusCode: resp.StatusCode, Body: strings.TrimSpace(string(preview))}
	}
	var wire geminiGenerateResponse
	if err := json.NewDecoder(resp.Body).Decode(&wire); err != nil {
		return openai.ChatCompletionResponse{}, err
	}
	return geminiToPivotResponse(wire, model), nil
}

func (a *GeminiAdaptor) Stream(ctx context.Context, req openai.ChatCompletionRequest, ch channel.Channel, push StreamPush) error {
	endpoint, apiKey, err := geminiPrepare(ch)
	if err != nil {
		return err
	}
	model := modelForChannel(ch, req.Model)
	url := fmt.Sprintf("%s/v1beta/models/%s:streamGenerateContent?alt=sse", strings.TrimRight(endpoint, "/"), model)
	body, err := json.Marshal(pivotToGeminiRequest(req))
	if err != nil {
		return err
	}
	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		return err
	}
	setGeminiHeaders(httpReq, apiKey)
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
	return parseGeminiSSE(resp.Body, model, push)
}

func (a *GeminiAdaptor) Embeddings(ctx context.Context, req openai.EmbeddingRequest, ch channel.Channel) (openai.EmbeddingResponse, error) {
	_ = ctx
	_ = req
	_ = ch
	return openai.EmbeddingResponse{}, fmt.Errorf("gemini: embeddings not supported")
}

type geminiGenerateRequest struct {
	Contents          []geminiContentWire         `json:"contents"`
	SystemInstruction *geminiContentWire          `json:"systemInstruction,omitempty"`
	GenerationConfig  *geminiGenerationConfigWire `json:"generationConfig,omitempty"`
	Tools             []geminiToolWire            `json:"tools,omitempty"`
}

type geminiContentWire struct {
	Role  string              `json:"role,omitempty"`
	Parts []map[string]string `json:"parts"`
}

type geminiGenerationConfigWire struct {
	Temperature     float64  `json:"temperature,omitempty"`
	TopP            float64  `json:"topP,omitempty"`
	MaxOutputTokens int      `json:"maxOutputTokens,omitempty"`
	StopSequences   []string `json:"stopSequences,omitempty"`
	ThinkingConfig  map[string]any `json:"thinkingConfig,omitempty"`
}

type geminiToolWire struct {
	FunctionDeclarations []transform.GeminiFunctionDeclaration `json:"functionDeclarations,omitempty"`
}

type geminiGenerateResponse struct {
	Candidates []struct {
		Content struct {
			Parts []struct {
				Text string `json:"text"`
			} `json:"parts"`
		} `json:"content"`
	} `json:"candidates"`
	UsageMetadata struct {
		PromptTokenCount     int `json:"promptTokenCount"`
		CandidatesTokenCount int `json:"candidatesTokenCount"`
		TotalTokenCount      int `json:"totalTokenCount"`
	} `json:"usageMetadata"`
}

func pivotToGeminiRequest(req openai.ChatCompletionRequest) geminiGenerateRequest {
	out := geminiGenerateRequest{}
	if req.System != "" {
		out.SystemInstruction = &geminiContentWire{
			Parts: []map[string]string{{"text": req.System}},
		}
	}
	maxTok := req.MaxTokens
	if maxTok <= 0 {
		maxTok = req.MaxCompletionTokens
	}
	if req.Temperature > 0 || req.TopP > 0 || maxTok > 0 || len(req.Stop) > 0 || req.ThinkingBudget > 0 {
		cfg := &geminiGenerationConfigWire{
			Temperature:     req.Temperature,
			TopP:            req.TopP,
			MaxOutputTokens: maxTok,
			StopSequences:   req.Stop,
		}
		if req.ThinkingBudget > 0 {
			cfg.ThinkingConfig = map[string]any{"thinkingBudget": req.ThinkingBudget}
		}
		out.GenerationConfig = cfg
	}
	if len(req.Tools) > 0 {
		out.Tools = []geminiToolWire{{FunctionDeclarations: transform.OpenAIToolsToGemini(req.Tools)}}
	}
	for _, m := range req.Messages {
		role := strings.ToLower(m.Role)
		if role == "assistant" {
			role = "model"
		} else {
			role = "user"
		}
		out.Contents = append(out.Contents, geminiContentWire{
			Role:  role,
			Parts: []map[string]string{{"text": m.Content}},
		})
	}
	return out
}

func geminiToPivotResponse(wire geminiGenerateResponse, model string) openai.ChatCompletionResponse {
	text := strings.Builder{}
	if len(wire.Candidates) > 0 {
		for _, p := range wire.Candidates[0].Content.Parts {
			text.WriteString(p.Text)
		}
	}
	inTok := wire.UsageMetadata.PromptTokenCount
	outTok := wire.UsageMetadata.CandidatesTokenCount
	if wire.UsageMetadata.TotalTokenCount > 0 && inTok+outTok == 0 {
		inTok = wire.UsageMetadata.TotalTokenCount / 2
		outTok = wire.UsageMetadata.TotalTokenCount - inTok
	}
	return openai.ChatCompletionResponse{
		Object: "chat.completion",
		Model:  model,
		Choices: []openai.ChatCompletionChoice{{
			Index:        0,
			Message:      openai.ChatMessage{Role: "assistant", Content: text.String()},
			FinishReason: "stop",
		}},
		Usage: openai.Usage{
			PromptTokens:     inTok,
			CompletionTokens: outTok,
			TotalTokens:      inTok + outTok,
		},
	}
}

func geminiPrepare(ch channel.Channel) (endpoint, apiKey string, err error) {
	endpoint = strings.TrimSpace(ch.BaseURL)
	if endpoint == "" {
		endpoint = "https://generativelanguage.googleapis.com"
	}
	apiKey = strings.TrimSpace(ch.APIKey)
	if apiKey == "" {
		return "", "", fmt.Errorf("channel missing api key")
	}
	return endpoint, apiKey, nil
}

func setGeminiHeaders(req *http.Request, apiKey string) {
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("x-goog-api-key", apiKey)
}

func parseGeminiSSE(body io.Reader, model string, push StreamPush) error {
	scanner := bufio.NewScanner(body)
	scanner.Buffer(make([]byte, 0, 64*1024), 16*1024*1024)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if !strings.HasPrefix(line, "data:") {
			continue
		}
		payload := strings.TrimSpace(strings.TrimPrefix(line, "data:"))
		if payload == "" || payload == "[DONE]" {
			continue
		}
		var wire geminiGenerateResponse
		if err := json.Unmarshal([]byte(payload), &wire); err != nil {
			continue
		}
		text := strings.Builder{}
		if len(wire.Candidates) > 0 {
			for _, p := range wire.Candidates[0].Content.Parts {
				text.WriteString(p.Text)
			}
		}
		if text.Len() == 0 {
			continue
		}
		if err := push(openai.StreamChunk{
			Object: "chat.completion.chunk",
			Model:  model,
			Choices: []openai.StreamChoice{{
				Index: 0,
				Delta: openai.StreamDelta{Content: text.String()},
			}},
		}); err != nil {
			return err
		}
	}
	return scanner.Err()
}
