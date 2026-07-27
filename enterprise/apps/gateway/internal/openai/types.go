package openai

import "encoding/json"

type ToolFunction struct {
	Name        string `json:"name"`
	Description string `json:"description,omitempty"`
	Parameters  any    `json:"parameters,omitempty"`
}

type Tool struct {
	Type     string        `json:"type"`
	Function *ToolFunction `json:"function,omitempty"`
}

// ToolCallFunction is the function payload inside a tool_calls entry
// (request history, non-stream assistant message, or stream delta).
type ToolCallFunction struct {
	Name      string `json:"name,omitempty"`
	Arguments string `json:"arguments,omitempty"`
}

// ToolCall is an OpenAI-compatible tool call. Index is set on stream deltas.
type ToolCall struct {
	Index    *int              `json:"index,omitempty"`
	ID       string            `json:"id,omitempty"`
	Type     string            `json:"type,omitempty"`
	Function *ToolCallFunction `json:"function,omitempty"`
}

type ChatMessage struct {
	Role             string          `json:"role"`
	Content          json.RawMessage `json:"content"`
	ReasoningContent string          `json:"reasoning_content,omitempty"`
	ToolCalls        []ToolCall      `json:"tool_calls,omitempty"`
	ToolCallID       string          `json:"tool_call_id,omitempty"`
	Name             string          `json:"name,omitempty"`
	CacheControl     json.RawMessage `json:"__cache_control,omitempty"`
}

type ChatCompletionRequest struct {
	Model               string        `json:"model"`
	Messages            []ChatMessage `json:"messages"`
	System              string          `json:"system,omitempty"`
	SystemCacheControl  json.RawMessage `json:"-"`
	Temperature         float64       `json:"temperature,omitempty"`
	Stream              bool          `json:"stream,omitempty"`
	MaxCompletionTokens int           `json:"max_completion_tokens,omitempty"`
	MaxTokens           int           `json:"max_tokens,omitempty"`
	TopP                float64       `json:"top_p,omitempty"`
	Stop                []string      `json:"stop,omitempty"`
	Tools               []Tool        `json:"tools,omitempty"`
	ToolChoice          any           `json:"tool_choice,omitempty"`
	ReasoningEffort     string        `json:"reasoning_effort,omitempty"`
	// ReasoningSplit requests providers that support split reasoning/content streams.
	// Pointer distinguishes omitted vs explicit false.
	ReasoningSplit *bool `json:"reasoning_split,omitempty"`
	// ThinkingBudget tokens for Anthropic/Gemini thinking models (internal pivot field).
	ThinkingBudget int `json:"-"`
}

type ChatCompletionChoice struct {
	Index        int         `json:"index"`
	Message      ChatMessage `json:"message"`
	FinishReason string      `json:"finish_reason"`
}

type PromptTokensDetails struct {
	CachedTokens int `json:"cached_tokens,omitempty"`
}

type Usage struct {
	PromptTokens             int                  `json:"prompt_tokens"`
	CompletionTokens         int                  `json:"completion_tokens"`
	TotalTokens              int                  `json:"total_tokens"`
	CachedTokens             int                  `json:"cached_tokens,omitempty"`
	CacheCreationInputTokens int                  `json:"cache_creation_input_tokens,omitempty"`
	CacheReadInputTokens     int                  `json:"cache_read_input_tokens,omitempty"`
	ReasoningTokens          int                  `json:"reasoning_tokens,omitempty"`
	PromptTokensDetails      *PromptTokensDetails `json:"prompt_tokens_details,omitempty"`
	Source                   string               `json:"-"`
}

type ChatCompletionResponse struct {
	ID      string                 `json:"id"`
	Object  string                 `json:"object"`
	Created int64                  `json:"created"`
	Model   string                 `json:"model"`
	Choices []ChatCompletionChoice `json:"choices"`
	Usage   Usage                  `json:"usage"`
}

type StreamDelta struct {
	Role             string     `json:"role,omitempty"`
	Content          string     `json:"content,omitempty"`
	ReasoningContent string     `json:"reasoning_content,omitempty"`
	ToolCalls        []ToolCall `json:"tool_calls,omitempty"`
}

type StreamChoice struct {
	Index        int         `json:"index"`
	Delta        StreamDelta `json:"delta"`
	FinishReason *string     `json:"finish_reason,omitempty"`
}

type StreamChunk struct {
	ID      string         `json:"id"`
	Object  string         `json:"object"`
	Created int64          `json:"created"`
	Model   string         `json:"model"`
	Choices []StreamChoice `json:"choices"`
}

type EmbeddingRequest struct {
	Model string   `json:"model"`
	Input []string `json:"input"`
}

type EmbeddingDatum struct {
	Object    string    `json:"object"`
	Index     int       `json:"index"`
	Embedding []float64 `json:"embedding"`
}

type EmbeddingResponse struct {
	Object string          `json:"object"`
	Model  string          `json:"model"`
	Data   []EmbeddingDatum `json:"data"`
	Usage  Usage           `json:"usage"`
}
