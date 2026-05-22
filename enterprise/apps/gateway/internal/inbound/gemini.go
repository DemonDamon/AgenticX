package inbound

import (
	"encoding/json"
	"fmt"
	"io"
	"strings"

	"github.com/agenticx/enterprise/gateway/internal/openai"
	"github.com/agenticx/enterprise/gateway/internal/transform"
)

const ProtocolGemini = "gemini-generate"

type geminiPart struct {
	Text string `json:"text,omitempty"`
}

type geminiContent struct {
	Role  string       `json:"role,omitempty"`
	Parts []geminiPart `json:"parts"`
}

type geminiGenerationConfig struct {
	Temperature     *float64 `json:"temperature,omitempty"`
	TopP            *float64 `json:"topP,omitempty"`
	MaxOutputTokens *int     `json:"maxOutputTokens,omitempty"`
	StopSequences   []string `json:"stopSequences,omitempty"`
}

type geminiTool struct {
	FunctionDeclarations []transform.GeminiFunctionDeclaration `json:"functionDeclarations,omitempty"`
}

type GeminiGenerateRequest struct {
	Contents          []geminiContent        `json:"contents"`
	SystemInstruction *geminiContent         `json:"systemInstruction,omitempty"`
	GenerationConfig  *geminiGenerationConfig `json:"generationConfig,omitempty"`
	Tools             []geminiTool           `json:"tools,omitempty"`
	SafetySettings    json.RawMessage        `json:"safetySettings,omitempty"`
}

type geminiInboundPayload struct {
	GeminiGenerateRequest
	Model string `json:"-"`
	Stream bool  `json:"-"`
}

// ParseGeminiGenerate parses Gemini generateContent body; model comes from URL path.
func ParseGeminiGenerate(body io.Reader, model string, stream bool) (openai.ChatCompletionRequest, error) {
	model = strings.TrimSpace(model)
	if model == "" {
		return openai.ChatCompletionRequest{}, fmt.Errorf("model is required")
	}
	var raw GeminiGenerateRequest
	if err := json.NewDecoder(body).Decode(&raw); err != nil {
		return openai.ChatCompletionRequest{}, fmt.Errorf("invalid gemini json: %w", err)
	}
	req := openai.ChatCompletionRequest{
		Model:  model,
		Stream: stream,
	}
	if raw.GenerationConfig != nil {
		if raw.GenerationConfig.Temperature != nil {
			req.Temperature = *raw.GenerationConfig.Temperature
		}
		if raw.GenerationConfig.TopP != nil {
			req.TopP = *raw.GenerationConfig.TopP
		}
		if raw.GenerationConfig.MaxOutputTokens != nil {
			req.MaxTokens = *raw.GenerationConfig.MaxOutputTokens
		}
		req.Stop = raw.GenerationConfig.StopSequences
	}
	if raw.SystemInstruction != nil {
		req.System = geminiContentText(*raw.SystemInstruction)
	}
	for _, toolGroup := range raw.Tools {
		req.Tools = append(req.Tools, transform.GeminiToolsToOpenAI(toolGroup.FunctionDeclarations)...)
	}
	for _, c := range raw.Contents {
		role := strings.ToLower(strings.TrimSpace(c.Role))
		switch role {
		case "model", "assistant":
			role = "assistant"
		default:
			role = "user"
		}
		text := geminiContentText(c)
		if text == "" {
			continue
		}
		req.Messages = append(req.Messages, openai.ChatMessage{Role: role, Content: text})
	}
	if len(req.Messages) == 0 {
		return openai.ChatCompletionRequest{}, fmt.Errorf("contents is required")
	}
	return req, nil
}

func geminiContentText(c geminiContent) string {
	var b strings.Builder
	for _, p := range c.Parts {
		if p.Text != "" {
			b.WriteString(p.Text)
		}
	}
	return b.String()
}
