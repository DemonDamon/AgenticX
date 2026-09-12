# Cache & Pricing Architecture

网关可选 L1 精确缓存与 L2 语义缓存。计费把上游 cache token 字段归一后，按 `internal/metering/pricing.yaml` 计价。运维开关见 [runbooks/ai-cache.md](../runbooks/ai-cache.md)。

## Canonical Key

`sha256(JSON({ tenant_id, user_id, model, messages, tools, temperature, ... }))`，排除 `stream` 与副作用工具调用（`tools` + `tool_choice != none`）。

相同对话、相同模型、无工具副作用时才可能命中。流式请求仍按同一 key 回放（`GATEWAY_CACHE_REPLAY_MODE`，默认 `burst`）。

## 开关（进程环境变量）

| 环境变量 | 默认 | 说明 |
|---|---|---|
| `GATEWAY_CACHE_L1` | `on` | L1 精确缓存 |
| `GATEWAY_CACHE_L2` | `off` | L2 语义缓存 |
| `GATEWAY_CACHE_L1_TTL` | `5m` | L1 TTL |
| `GATEWAY_CACHE_SEMANTIC_THRESHOLD` | `0.92` | L2 相似度阈值 |
| `REDIS_URL` | 空 | 配置后 L1 走 Redis；否则进程内 |

Admin `/admin/cache` 写入 `enterprise/.runtime/admin/cache-config.json`，保存后打网关 `/internal/cache/reload`。驱逐：`POST /internal/cache/evict`（需 `GATEWAY_INTERNAL_TOKEN`）。

两层都 `off` 并重启后，行为与未启用缓存一致。

## Usage 归一

| 上游 | 字段 |
|---|---|
| OpenAI | `prompt_tokens_details.cached_tokens` |
| Claude | `cache_creation_input_tokens` / `cache_read_input_tokens` |
| DeepSeek | `prompt_cache_hit_tokens` |
| Gemini | `cachedContentTokenCount` |

## 计费

`internal/metering/pricing.yaml` 定义 `cached_input` / `cache_creation` / `cache_read` 单价；网关 L1/L2 命中写入 `usage.source=gateway_cache` 并按折扣比计费。Prometheus 计数见 [observability/README.md](../observability/README.md) 的 `agx_gateway_cache_*`。

Made-with: Damon Li
