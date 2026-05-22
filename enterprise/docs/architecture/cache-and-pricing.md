# Cache & Pricing Architecture

## Canonical Key

`sha256(JSON({ tenant_id, user_id, model, messages, tools, temperature, ... }))`，排除 `stream` 与副作用工具调用（`tools` + `tool_choice != none`）。

## Usage 归一

| 上游 | 字段 |
|---|---|
| OpenAI | `prompt_tokens_details.cached_tokens` |
| Claude | `cache_creation_input_tokens` / `cache_read_input_tokens` |
| DeepSeek | `prompt_cache_hit_tokens` |
| Gemini | `cachedContentTokenCount` |

## 计费

`internal/metering/pricing.yaml` 定义 `cached_input` / `cache_creation` / `cache_read` 单价；网关 L1/L2 命中写入 `usage.source=gateway_cache` 并按折扣比计费。
