// Adapted from higress-group/higress ai-proxy (Apache-2.0) — Bedrock Converse API subset.
package adaptor

import (
	"bytes"
	"context"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/agenticx/enterprise/gateway/internal/channel"
	"github.com/agenticx/enterprise/gateway/internal/openai"
)

type BedrockAdaptor struct {
	httpClient *http.Client
	streamCfg  StreamConfig
	now        func() time.Time
}

func NewBedrockAdaptor(opts ...OpenAIOption) *BedrockAdaptor {
	cfg := StreamConfigFromEnv()
	a := &OpenAIAdaptor{streamCfg: cfg}
	for _, opt := range opts {
		if opt != nil {
			opt(a)
		}
	}
	return &BedrockAdaptor{
		httpClient: &http.Client{Timeout: 120 * time.Second},
		streamCfg:  cfg,
		now:        time.Now,
	}
}

func (a *BedrockAdaptor) Name() string { return "bedrock" }

func (a *BedrockAdaptor) Complete(
	ctx context.Context,
	req openai.ChatCompletionRequest,
	ch channel.Channel,
) (openai.ChatCompletionResponse, error) {
	cred, modelID, err := bedrockPrepare(ch, req.Model)
	if err != nil {
		return openai.ChatCompletionResponse{}, err
	}
	body, err := json.Marshal(openAIToBedrockConverse(req))
	if err != nil {
		return openai.ChatCompletionResponse{}, err
	}
	targetURL := bedrockConverseURL(cred.region, modelID, false)
	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, targetURL, bytes.NewReader(body))
	if err != nil {
		return openai.ChatCompletionResponse{}, err
	}
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("Accept", "application/json")
	if err := signRequest(httpReq, sigV4Credentials{
		AccessKey: cred.accessKey,
		SecretKey: cred.secretKey,
		Region:    cred.region,
		Service:   "bedrock",
	}, body, a.now()); err != nil {
		return openai.ChatCompletionResponse{}, err
	}
	resp, err := a.httpClient.Do(httpReq)
	if err != nil {
		return openai.ChatCompletionResponse{}, fmt.Errorf("bedrock upstream failed: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		return openai.ChatCompletionResponse{}, readUpstreamError(resp)
	}
	var wire bedrockConverseResponse
	if err := json.NewDecoder(resp.Body).Decode(&wire); err != nil {
		return openai.ChatCompletionResponse{}, err
	}
	return bedrockConverseToOpenAI(wire, modelID), nil
}

func (a *BedrockAdaptor) Stream(
	ctx context.Context,
	req openai.ChatCompletionRequest,
	ch channel.Channel,
	push StreamPush,
) error {
	cred, modelID, err := bedrockPrepare(ch, req.Model)
	if err != nil {
		return err
	}
	body, err := json.Marshal(openAIToBedrockConverse(req))
	if err != nil {
		return err
	}
	targetURL := bedrockConverseURL(cred.region, modelID, true)
	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, targetURL, bytes.NewReader(body))
	if err != nil {
		return err
	}
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("Accept", "application/vnd.amazon.eventstream")
	if err := signRequest(httpReq, sigV4Credentials{
		AccessKey: cred.accessKey,
		SecretKey: cred.secretKey,
		Region:    cred.region,
		Service:   "bedrock",
	}, body, a.now()); err != nil {
		return err
	}
	streamClient := *a.httpClient
	streamClient.Timeout = 0
	resp, err := streamClient.Do(httpReq)
	if err != nil {
		return fmt.Errorf("bedrock stream failed: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		return readUpstreamError(resp)
	}
	return parseBedrockEventStream(resp.Body, modelID, push)
}

func (a *BedrockAdaptor) Embeddings(
	_ context.Context,
	_ openai.EmbeddingRequest,
	_ channel.Channel,
) (openai.EmbeddingResponse, error) {
	return openai.EmbeddingResponse{}, fmt.Errorf("bedrock: embeddings not supported")
}

type bedrockCreds struct {
	accessKey string
	secretKey string
	region    string
}

func bedrockPrepare(ch channel.Channel, model string) (bedrockCreds, string, error) {
	accessKey, secretKey := bedrockCredentials(ch)
	region := bedrockRegion(ch)
	if accessKey == "" || secretKey == "" {
		return bedrockCreds{}, "", fmt.Errorf("channel missing bedrock credentials")
	}
	if region == "" {
		return bedrockCreds{}, "", fmt.Errorf("channel missing bedrock region")
	}
	modelID := strings.TrimSpace(model)
	if modelID == "" {
		modelID = modelForChannel(ch, model)
	}
	if modelID == "" {
		return bedrockCreds{}, "", fmt.Errorf("channel missing model id")
	}
	return bedrockCreds{accessKey: accessKey, secretKey: secretKey, region: region}, modelID, nil
}

func bedrockConverseURL(region, modelID string, stream bool) string {
	suffix := "converse"
	if stream {
		suffix = "converse-stream"
	}
	return fmt.Sprintf("https://bedrock-runtime.%s.amazonaws.com/model/%s/%s", region, modelID, suffix)
}

type bedrockContentBlock struct {
	Text string `json:"text,omitempty"`
}

type bedrockMessage struct {
	Role    string                `json:"role"`
	Content []bedrockContentBlock `json:"content"`
}

type bedrockConverseRequest struct {
	System          []bedrockContentBlock `json:"system,omitempty"`
	Messages        []bedrockMessage      `json:"messages"`
	InferenceConfig *bedrockInference     `json:"inferenceConfig,omitempty"`
}

type bedrockInference struct {
	MaxTokens   int     `json:"maxTokens,omitempty"`
	Temperature float64 `json:"temperature,omitempty"`
	TopP        float64 `json:"topP,omitempty"`
}

type bedrockConverseResponse struct {
	Output struct {
		Message bedrockMessage `json:"message"`
	} `json:"output"`
	Usage struct {
		InputTokens  int `json:"inputTokens"`
		OutputTokens int `json:"outputTokens"`
		TotalTokens  int `json:"totalTokens"`
	} `json:"usage"`
	StopReason string `json:"stopReason"`
}

func openAIToBedrockConverse(req openai.ChatCompletionRequest) bedrockConverseRequest {
	out := bedrockConverseRequest{}
	if strings.TrimSpace(req.System) != "" {
		out.System = []bedrockContentBlock{{Text: req.System}}
	}
	for _, msg := range req.Messages {
		role := strings.ToLower(strings.TrimSpace(msg.Role))
		switch role {
		case "system":
			out.System = append(out.System, bedrockContentBlock{Text: openai.ContentText(msg.Content)})
			continue
		case "assistant", "user":
			// ok
		default:
			if role == "" {
				role = "user"
			} else {
				role = "user"
			}
		}
		out.Messages = append(out.Messages, bedrockMessage{
			Role:    role,
			Content: []bedrockContentBlock{{Text: openai.ContentText(msg.Content)}},
		})
	}
	inf := &bedrockInference{}
	hasInf := false
	if req.MaxCompletionTokens > 0 {
		inf.MaxTokens = req.MaxCompletionTokens
		hasInf = true
	} else if req.MaxTokens > 0 {
		inf.MaxTokens = req.MaxTokens
		hasInf = true
	}
	if req.Temperature > 0 {
		inf.Temperature = req.Temperature
		hasInf = true
	}
	if req.TopP > 0 {
		inf.TopP = req.TopP
		hasInf = true
	}
	if hasInf {
		out.InferenceConfig = inf
	}
	return out
}

func bedrockConverseToOpenAI(wire bedrockConverseResponse, model string) openai.ChatCompletionResponse {
	text := bedrockMessageText(wire.Output.Message)
	finish := strings.TrimSpace(wire.StopReason)
	if finish == "" {
		finish = "stop"
	}
	return openai.ChatCompletionResponse{
		ID:      "bedrock-" + model,
		Object:  "chat.completion",
		Created: time.Now().Unix(),
		Model:   model,
		Choices: []openai.ChatCompletionChoice{{
			Index: 0,
			Message: openai.ChatMessage{
				Role:    "assistant",
				Content: openai.NewStringContent(text),
			},
			FinishReason: finish,
		}},
		Usage: openai.Usage{
			PromptTokens:     wire.Usage.InputTokens,
			CompletionTokens: wire.Usage.OutputTokens,
			TotalTokens:      wire.Usage.TotalTokens,
		},
	}
}

func bedrockMessageText(msg bedrockMessage) string {
	var b strings.Builder
	for _, block := range msg.Content {
		b.WriteString(block.Text)
	}
	return b.String()
}

type bedrockStreamEvent struct {
	ContentBlockDelta *struct {
		Delta struct {
			Text string `json:"text"`
		} `json:"delta"`
	} `json:"contentBlockDelta"`
	MessageStop *struct {
		StopReason string `json:"stopReason"`
	} `json:"messageStop"`
}

func bedrockStreamEventToChunk(model string, ev bedrockStreamEvent) (openai.StreamChunk, bool) {
	if ev.ContentBlockDelta != nil {
		text := ev.ContentBlockDelta.Delta.Text
		if text == "" {
			return openai.StreamChunk{}, false
		}
		return openai.StreamChunk{
			ID:      "bedrock-stream",
			Object:  "chat.completion.chunk",
			Created: time.Now().Unix(),
			Model:   model,
			Choices: []openai.StreamChoice{{
				Index: 0,
				Delta: openai.StreamDelta{Content: text},
			}},
		}, true
	}
	if ev.MessageStop != nil {
		reason := ev.MessageStop.StopReason
		if reason == "" {
			reason = "stop"
		}
		return openai.StreamChunk{
			ID:      "bedrock-stream",
			Object:  "chat.completion.chunk",
			Created: time.Now().Unix(),
			Model:   model,
			Choices: []openai.StreamChoice{{
				Index:        0,
				Delta:        openai.StreamDelta{},
				FinishReason: &reason,
			}},
		}, true
	}
	return openai.StreamChunk{}, false
}

func parseBedrockEventStream(body io.Reader, model string, push StreamPush) error {
	for {
		payload, err := readBedrockEventPayload(body)
		if err == io.EOF {
			return nil
		}
		if err != nil {
			return err
		}
		if len(payload) == 0 {
			continue
		}
		var ev bedrockStreamEvent
		if err := json.Unmarshal(payload, &ev); err != nil {
			continue
		}
		chunk, ok := bedrockStreamEventToChunk(model, ev)
		if !ok {
			continue
		}
		if err := push(chunk); err != nil {
			return err
		}
	}
}

func readBedrockEventPayload(r io.Reader) ([]byte, error) {
	var totalLen uint32
	if err := binary.Read(r, binary.BigEndian, &totalLen); err != nil {
		return nil, err
	}
	if totalLen < 16 {
		return nil, fmt.Errorf("bedrock event: invalid prelude")
	}
	var headersLen uint32
	if err := binary.Read(r, binary.BigEndian, &headersLen); err != nil {
		return nil, err
	}
	var preludeCRC uint32
	if err := binary.Read(r, binary.BigEndian, &preludeCRC); err != nil {
		return nil, err
	}
	_ = preludeCRC
	if headersLen > 0 {
		if _, err := io.CopyN(io.Discard, r, int64(headersLen)); err != nil {
			return nil, err
		}
	}
	payloadLen := int(totalLen) - int(headersLen) - 16
	if payloadLen < 0 {
		return nil, fmt.Errorf("bedrock event: negative payload")
	}
	payload := make([]byte, payloadLen)
	if _, err := io.ReadFull(r, payload); err != nil {
		return nil, err
	}
	var msgCRC uint32
	if err := binary.Read(r, binary.BigEndian, &msgCRC); err != nil {
		return nil, err
	}
	_ = msgCRC
	return payload, nil
}

func readUpstreamError(resp *http.Response) error {
	preview, _ := io.ReadAll(io.LimitReader(resp.Body, 2048))
	return &UpstreamError{StatusCode: resp.StatusCode, Body: strings.TrimSpace(string(preview))}
}
