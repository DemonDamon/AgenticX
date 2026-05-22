package transform

import (
	"encoding/json"
	"strings"

	"github.com/agenticx/enterprise/gateway/internal/openai"
)

// ClaudeTool describes Anthropic tool wire format.
type ClaudeTool struct {
	Name        string          `json:"name"`
	Description string          `json:"description,omitempty"`
	InputSchema json.RawMessage `json:"input_schema,omitempty"`
}

// OpenAIToolsToClaude converts OpenAI function tools to Claude tools.
func OpenAIToolsToClaude(tools []openai.Tool) []ClaudeTool {
	out := make([]ClaudeTool, 0, len(tools))
	for _, t := range tools {
		if !strings.EqualFold(strings.TrimSpace(t.Type), "function") || t.Function == nil {
			continue
		}
		schema, _ := json.Marshal(t.Function.Parameters)
		if len(schema) == 0 {
			schema = json.RawMessage(`{"type":"object","properties":{}}`)
		}
		out = append(out, ClaudeTool{
			Name:        t.Function.Name,
			Description: t.Function.Description,
			InputSchema: schema,
		})
	}
	return out
}

// ClaudeToolsToOpenAI converts Claude tools to OpenAI pivot tools.
func ClaudeToolsToOpenAI(tools []ClaudeTool) []openai.Tool {
	out := make([]openai.Tool, 0, len(tools))
	for _, t := range tools {
		var params any
		if len(t.InputSchema) > 0 {
			_ = json.Unmarshal(t.InputSchema, &params)
		}
		out = append(out, openai.Tool{
			Type: "function",
			Function: &openai.ToolFunction{
				Name:        t.Name,
				Description: t.Description,
				Parameters:  params,
			},
		})
	}
	return out
}

// GeminiFunctionDeclaration for Google GenAI REST.
type GeminiFunctionDeclaration struct {
	Name        string `json:"name"`
	Description string `json:"description,omitempty"`
	Parameters  any    `json:"parameters,omitempty"`
}

func OpenAIToolsToGemini(tools []openai.Tool) []GeminiFunctionDeclaration {
	out := make([]GeminiFunctionDeclaration, 0, len(tools))
	for _, t := range tools {
		if !strings.EqualFold(strings.TrimSpace(t.Type), "function") || t.Function == nil {
			continue
		}
		out = append(out, GeminiFunctionDeclaration{
			Name:        t.Function.Name,
			Description: t.Function.Description,
			Parameters:  t.Function.Parameters,
		})
	}
	return out
}

func GeminiToolsToOpenAI(decls []GeminiFunctionDeclaration) []openai.Tool {
	out := make([]openai.Tool, 0, len(decls))
	for _, d := range decls {
		out = append(out, openai.Tool{
			Type: "function",
			Function: &openai.ToolFunction{
				Name:        d.Name,
				Description: d.Description,
				Parameters:  d.Parameters,
			},
		})
	}
	return out
}
