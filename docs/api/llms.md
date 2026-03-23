# agenticx.llms

English API reference for the AgenticX LLM provider layer: base contracts, response models, concrete providers, failover, auth profile rotation, response caching, transcript sanitization, and config resolution.

---

## BaseLLMProvider

Abstract base class for all chat/completion providers (`agenticx.llms.base`).

### Field

| Name | Type | Description |
|------|------|-------------|
| `model` | `str` | Model identifier (may include LiteLLM-style prefixes such as `anthropic/`, `ollama/`, `gemini/`). |

### Methods

| Method | Returns | Description |
|--------|---------|-------------|
| `invoke(prompt, **kwargs)` | `LLMResponse` | Synchronous completion. |
| `ainvoke(prompt, **kwargs)` | `LLMResponse` | Async completion. |
| `stream(prompt, **kwargs)` | `Generator[Union[str, Dict], None, None]` | Synchronous streaming chunks. |
| `astream(prompt, **kwargs)` | `AsyncGenerator[Union[str, Dict], None]` | Async streaming chunks. |
| `stream_with_tools(prompt, tools=None, **kwargs)` | `Generator[StreamChunk, None, None]` | Tool-call-aware streaming (preferred path when the provider implements it). Default base implementation raises `NotImplementedError`. |
| `invoke_with_profile(prompt, api_key, **kwargs)` | `LLMResponse` | Used with **Auth Profile** rotation: forwards to `invoke(..., api_key=api_key, **kwargs)`. |
| `supports_auth_profile_rotation()` | `bool` | Whether the provider accepts per-call credential injection (default `True` on the base class). |

`StreamChunk` is a `TypedDict` with optional keys such as `type` (`"content" \| "tool_call_delta" \| "done"`), `text`, `tool_index`, `tool_call_id`, `tool_name`, `arguments_delta`, and `finish_reason`.

!!! note "Parameter name: `prompt` vs chat `messages`"
    The abstract API names the first argument `prompt`. It may be a **string** or a **list of chat messages** in OpenAI-style dict form (`[{"role": "user", "content": "..."}, ...]`). Some subclasses (for example `LiteLLMProvider.invoke`) also accept an explicit `tools=` argument for function calling.

---

## LLMResponse, TokenUsage, LLMChoice

Defined in `agenticx.llms.response`.

### LLMResponse

| Field | Type | Description |
|-------|------|-------------|
| `id` | `str` | Provider response identifier. |
| `model_name` | `str` | Model that produced the completion. |
| `created` | `int` | Unix timestamp. |
| `content` | `str` | Primary text (typically first choice). |
| `choices` | `List[LLMChoice]` | All completion choices. |
| `token_usage` | `TokenUsage` | Prompt / completion / total token counts. |
| `cost` | `Optional[float]` | Estimated cost when available. |
| `metadata` | `Dict[str, Any]` | Provider-specific extras. |
| `tool_calls` | `Optional[List[Dict[str, Any]]]` | Tool calls in OpenAI-style format when present. |

Conceptually, `token_usage` plus `cost` correspond to “usage” and billing metadata in other SDKs; the schema uses `model_name` rather than `model`.

### TokenUsage

| Field | Type | Description |
|-------|------|-------------|
| `prompt_tokens` | `int` | Default `0`. |
| `completion_tokens` | `int` | Default `0`. |
| `total_tokens` | `int` | Default `0`. |

Monetary cost is stored on `LLMResponse.cost`, not inside `TokenUsage`.

### LLMChoice

| Field | Type | Description |
|-------|------|-------------|
| `index` | `int` | Choice index. |
| `content` | `str` | Assistant text for this choice. |
| `finish_reason` | `Optional[str]` | Provider stop reason when provided. |

---

## Provider reference

Concrete classes are importable from `agenticx.llms` unless noted. Vision support is **model-dependent** unless a known limitation is called out.

| Class | Module | Vision | Notes |
|-------|--------|--------|-------|
| `OpenAIProvider` | `agenticx.llms` (extends `LiteLLMProvider`) | Model-dependent | OpenAI / OpenAI-compatible via LiteLLM. |
| `AnthropicProvider` | `agenticx.llms` (extends `LiteLLMProvider`) | Model-dependent | Prefer `anthropic/` model prefix when required. |
| `OllamaProvider` | `agenticx.llms` (extends `LiteLLMProvider`) | Model-dependent | Local; often `ollama/<model>`. |
| `GeminiProvider` | `agenticx.llms` (extends `LiteLLMProvider`) | Model-dependent | LiteLLM `gemini/` IDs. |
| `KimiProvider` | `agenticx.llms.kimi_provider` | Typically no (chat SKUs) | Moonshot / Kimi HTTP adapter; long context. |
| `MoonshotProvider` | `agenticx.llms` (extends `KimiProvider`) | Same as Kimi | Convenience alias for Kimi / Moonshot. |
| `MiniMaxProvider` / `MinimaxProvider` | `agenticx.llms.minimax_provider` / `agenticx.llms` | No for M2 chat family | Subclasses `LiteLLMProvider`; normalizes model (`openai/` prefix) and default `base_url`. M2-line chat models do not accept image/audio per product rules. |
| `ArkProvider` / `ArkLLMProvider` | `agenticx.llms.ark_provider` | Model-dependent | Volcengine Ark (火山引擎 / Doubao). |
| `ZhipuProvider` | `agenticx.llms.zhipu_provider` | Model-dependent (e.g. GLM-4V) | Zhipu GLM. |
| `QianfanProvider` | `agenticx.llms.qianfan_provider` | Model-dependent | Baidu Qianfan; may need `secret_key` in config. |
| `BailianProvider` | `agenticx.llms.bailian_provider` | Model-dependent | Alibaba Bailian / Dashscope. |
| `DashscopeProvider` | `agenticx.llms` (extends `BailianProvider`) | Same as Bailian | Convenience alias for 阿里百炼 / Dashscope. |
| `LiteLLMProvider` | `agenticx.llms.litellm_provider` | Model-dependent | Generic LiteLLM backend; implements `invoke(..., tools=None)`, streaming, and `stream_with_tools`. |
| SiliconFlow (no dedicated class) | `agenticx.llms.litellm_provider` | Model-dependent | Use `LiteLLMProvider` with SiliconFlow OpenAI-compatible `base_url` and API key. |
| `FailoverProvider` | `agenticx.llms.failover` | Inherits from wrapped providers | Primary / fallback routing with cooldown (see below). |

---

## FailoverProvider

`FailoverProvider` (`agenticx.llms.failover`) wraps two `BaseLLMProvider` instances:

- **`primary`** — preferred backend.
- **`fallback`** — used when the primary is in cooldown or raises.

Configuration fields:

| Field | Default | Description |
|-------|---------|-------------|
| `failure_threshold` | `3` | Consecutive primary failures before entering cooldown. |
| `cooldown_duration` | `60.0` | Seconds the primary is bypassed after the threshold is reached. |

A successful primary call resets the failure counter and clears cooldown.

!!! warning "Streaming failover does not roll back yielded output"
    For `stream`, `astream`, and `stream_with_tools`, if the **primary** fails **after** some chunks were already yielded, those chunks stay with the client. The implementation then records the failure and subsequent chunks may come from the **fallback** (or the stream may end depending on call site handling). There is no automatic rewind or merge of partial primary output with fallback output.

---

## AuthProfileManager

Types and manager live in `agenticx.llms.auth_profile`.

### AuthProfile

| Field | Type | Description |
|-------|------|-------------|
| `name` | `str` | Profile label. |
| `provider` | `str` | Logical provider name. |
| `api_key` | `str` | Credential (or placeholder depending on setup). |
| `profile_type` | `str` | Default `"api_key"`. |
| `last_used` | `float` | Epoch time of last successful use. |
| `cooldown` | `AuthProfileCooldown` | Backoff / disable state. |

`is_available` is a derived property: current time must be past both `cooldown_until` and `disabled_until`.

### AuthProfileCooldown

| Field | Type | Description |
|-------|------|-------------|
| `cooldown_until` | `float` | Epoch; temporary backoff. |
| `disabled_until` | `float` | Epoch; longer-lived disable window (persisted when set). |
| `error_count` | `int` | Consecutive failure counter for backoff. |
| `failure_type` | `str` | Last classified failure (`billing`, `auth`, `rate_limit`, `other`, …). |

### AuthProfileManager API

| Method | Description |
|--------|-------------|
| `get_current()` | Returns the next usable profile: available profiles first (sorted by `last_used`), then cooling profiles ordered by `cooldown_until`. Updates `_current_index`. |
| `mark_success(profile_name)` | Clears error state and cooldown timestamps for that profile; updates persistence. |
| `mark_failure(profile_name, failure_type)` | Increments `error_count`, sets `failure_type`, computes cooldown via `_compute_cooldown_ms`, sets `cooldown_until`. |
| `advance(exclude_name=None)` | Moves to another profile, optionally skipping one name; persists. |
| `classify_failure(error)` | Maps an `Exception` to `billing`, `auth`, `rate_limit`, or `other` using message heuristics. |

### Cooldown policy

Backoff is computed in milliseconds then applied as `cooldown_until = now + ms/1000`:

| Failure bucket | Base | Cap | Multiplier |
|----------------|------|-----|------------|
| `rate_limit` (and non-`billing` paths including `auth`, `other`, …) | 60 s | 1 h | `5 ** min(error_count - 1, 3)` applied to the 60 s base (capped). |
| `billing` | 5 h | 24 h | `2 ** min(error_count - 1, 10)` applied to the 5 h base (capped). |

Constants in code: `RATE_LIMIT_BASE_MS`, `RATE_LIMIT_CAP_MS`, `BILLING_BASE_MS`, `BILLING_CAP_MS`.

### JSON persistence

When `persistence_path` is set, `_persist()` writes **only** `last_used` and `cooldown` fields per profile name to JSON: write to a `*.tmp` file, then `replace()` onto the final path for atomic update.

```python
from pathlib import Path
from agenticx.llms.auth_profile import AuthProfile, AuthProfileCooldown, AuthProfileManager

manager = AuthProfileManager(
    profiles=[...],
    persistence_path=Path("~/.agenticx/auth_profiles.json").expanduser(),
)
```

---

## ResponseCache

`ResponseCache` (`agenticx.llms.response_cache`) is an in-memory cache:

- **Key:** SHA-256 hash of the **string** prompt; implementation stores the first **32 hex characters** of the digest for compact keys.
- **TTL:** `ttl_seconds` (default `300`).
- **Eviction:** LRU when size exceeds `max_entries` (default `100`).

| Method | Description |
|--------|-------------|
| `get(prompt)` | Returns `LLMResponse` or `None` if missing or expired. |
| `put(prompt, response)` | Inserts or updates; may evict oldest. |
| `stats()` | Returns `hits`, `misses`, `size`, `hit_rate`. |
| `invalidate()` | Clears all entries. |

---

## TranscriptSanitizer

`TranscriptSanitizer` and `TranscriptPolicy` live in `agenticx.llms.transcript_sanitizer`.

### TranscriptPolicy

| Field | Default | Description |
|-------|---------|-------------|
| `provider` | required | Policy bucket key. |
| `enforce_turn_alternation` | `False` | Drops consecutive messages with the same role (after the first). |
| `merge_consecutive_user_turns` | `False` | Merges adjacent `user` turns into one. |
| `sanitize_tool_schema` | `False` | Normalizes `tools` payloads on messages to `name` / `description` / `parameters`. |
| `strip_refusal_triggers` | `False` | Removes regex-matched refusal-style phrases from content. |

### PROVIDER_POLICIES

| Key | Typical match | Notable flags |
|-----|----------------|---------------|
| `anthropic` | Provider id contains `anthropic` | Turn alternation, merge user turns, strip refusal triggers. |
| `google` | Contains `google` | Turn alternation, sanitize tool schema. |
| `openai` | Contains `openai` | Defaults only. |
| `ollama` | Contains `ollama` | Defaults only. |

Resolution uses substring match on `provider.lower()`; unknown providers get a default `TranscriptPolicy(provider=...)`.

### API

```python
sanitizer = TranscriptSanitizer()
cleaned = sanitizer.sanitize(messages, provider="anthropic")
```

`messages` are `List[Dict[str, Any]]` with `role` and `content`; invalid roles are dropped.

---

## ProviderResolver

`ProviderResolver` (`agenticx.llms.provider_resolver`) maps **configuration provider names** to concrete `BaseLLMProvider` **classes**. It does not list every marketing name (for example SiliconFlow); those are still constructed via `LiteLLMProvider` in application code.

`PROVIDER_MAP` (keys are lower-case config names):

| Config key | Class |
|------------|--------|
| `openai` | `LiteLLMProvider` |
| `anthropic` | `LiteLLMProvider` |
| `zhipu` | `ZhipuProvider` |
| `volcengine`, `ark` | `ArkLLMProvider` |
| `bailian` | `BailianProvider` |
| `qianfan` | `QianfanProvider` |
| `kimi` | `KimiProvider` |
| `minimax` | `MiniMaxProvider` |
| `ollama` | `LiteLLMProvider` |

Use `ProviderResolver.resolve(provider_name=None, model=None)` to build an instance from merged AGX config (`ConfigManager`).

!!! tip "Further reading"
    For end-user-oriented provider notes, env vars, and examples, see [LLM providers](../concepts/llm-providers.md).
