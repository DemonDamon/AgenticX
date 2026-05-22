# Protocol Translation Architecture

Enterprise Gateway uses an **OpenAI-compatible chat completion shape as the internal pivot DTO** (`openai.ChatCompletionRequest` / `StreamChunk`).

## Why pivot

- Channel relay and policy/quota already operate on pivot requests.
- Cross-protocol conversion stays **O(protocols)** via `inbound (X→pivot)` + `outbound (pivot→X)` instead of N×N matrices.

## Request path

```
Client wire format
  → inbound.Parse*()
  → transform.ResolveModel()  (reasoning effort / thinking budget)
  → policy + quota
  → relay.Executor → adaptor (upstream wire)
  → pivot stream chunks
  → outbound encoder (client wire)
```

## Packages

| Package | Role |
|---------|------|
| `internal/inbound` | Claude / Gemini / Responses → pivot |
| `internal/outbound` | pivot → client SSE/JSON |
| `internal/transform` | Model suffix rules, tools mapping, thinking modes |
| `internal/adaptor` | pivot ↔ upstream provider APIs |

## Reasoning effort suffixes

Examples: `gpt-5-high`, `o3-mini-low`, `claude-3-7-sonnet-thinking`, `gemini-2.5-flash-thinking-128`.

Rules live in `transform/reasoning_effort.go` and inject `reasoning_effort` or `thinkingBudget` into pivot/upstream payloads.

## Non-goals (this phase)

- Realtime WebSocket
- Full Responses `previous_response_id` chain
- Gemini→OpenAI function calling parity

Made-with: Damon Li
