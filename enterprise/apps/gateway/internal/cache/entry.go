package cache

import "github.com/agenticx/enterprise/gateway/internal/openai"

// Layer identifies which cache tier served a response.
type Layer string

const (
	LayerNone     Layer = "none"
	LayerL1       Layer = "L1"
	LayerL2       Layer = "L2"
	LayerUpstream Layer = "upstream-cache"
)

// Entry is a cached upstream or synthesized gateway response.
type Entry struct {
	Stream       bool                   `json:"stream"`
	Response     openai.ChatCompletionResponse `json:"response,omitempty"`
	StreamChunks []openai.StreamChunk   `json:"stream_chunks,omitempty"`
	Usage        openai.Usage           `json:"usage"`
}

// LookupResult describes a cache hit.
type LookupResult struct {
	Layer              Layer
	KeyHash            string
	SemanticSimilarity float64
	Entry              Entry
}
