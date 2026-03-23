# LLM providers

AgenticX routes chat and tools through `BaseLLMProvider` implementations. First-party adapters cover major Chinese cloud APIs; everything else can go through `LiteLLMProvider` (OpenAI-compatible or LiteLLM model IDs).

## Supported providers

| Provider | Primary Python class | Vision | Notes |
|----------|----------------------|--------|--------|
| OpenAI | `OpenAIProvider` (`LiteLLMProvider`) | Yes (model-dependent) | Default stack; vision on GPT-4o-class and similar |
| Anthropic | `AnthropicProvider` (`LiteLLMProvider`) | Yes (model-dependent) | Use `anthropic/` model prefix when required |
| Ollama | `OllamaProvider` (`LiteLLMProvider`) | Model-dependent | Local; typically `ollama/<model>` |
| Google Gemini | `GeminiProvider` (`LiteLLMProvider`) | Yes (model-dependent) | LiteLLM `gemini/` IDs |
| Kimi / Moonshot | `KimiProvider`, `MoonshotProvider` | No (typical chat SKUs) | Dedicated HTTP adapter; long context |
| MiniMax | `MiniMaxProvider`, `MinimaxProvider` | No for `M2*` chat line | `openai/` prefix applied internally; M2 family has no image/audio input (see below) |
| VolcEngine Ark | `ArkLLMProvider`, `ArkProvider`, `VolcEngineProvider` | Model-dependent | ByteDance Doubao / Ark endpoints |
| Zhipu GLM | `ZhipuProvider`, `ZhiPuProvider` | Yes on GLM-4V-class | Dedicated adapter |
| Baidu Qianfan | `QianfanProvider`, `QianFanProvider` | Model-dependent | May require `secret_key` in config |
| Alibaba Bailian / Dashscope | `BailianProvider`, `DashscopeProvider` | Model-dependent | Qwen-VL and cousins when configured |
| SiliconFlow | `LiteLLMProvider` | Model-dependent | Point `base_url` at SiliconFlow OpenAI-compatible API |
| LiteLLM (generic) | `LiteLLMProvider` | Model-dependent | Any LiteLLM-supported backend |
| Azure OpenAI | `LiteLLMProvider` | Model-dependent | `azure/` models; `api_version` + Azure key |
| DeepSeek | `LiteLLMProvider` | Model-dependent | Via LiteLLM routing |
| Groq | `LiteLLMProvider` | Model-dependent | Via LiteLLM `groq/` models |
| Mistral | `LiteLLMProvider` | Model-dependent | Via LiteLLM `mistral/` models |
| Together AI | `LiteLLMProvider` | Model-dependent | Via LiteLLM |
| xAI | `LiteLLMProvider` | Model-dependent | Via LiteLLM |

`ProviderResolver.PROVIDER_MAP` wires config keys `openai`, `anthropic`, `ollama`, `zhipu`, `volcengine` / `ark`, `bailian`, `qianfan`, `kimi`, `minimax` to the classes above.

## Usage

=== "OpenAI"

    ```python
    from agenticx.llms import OpenAIProvider

    llm = OpenAIProvider(
        model="gpt-4o",
        api_key="sk-...",  # or rely on env / config
    )
    resp = llm.invoke("Summarize this in one line.")
    ```

=== "Anthropic"

    ```python
    from agenticx.llms import AnthropicProvider

    llm = AnthropicProvider(
        model="anthropic/claude-sonnet-4-20250514",
        api_key="sk-ant-...",
    )
    resp = llm.invoke([{"role": "user", "content": "Hello"}])
    ```

=== "Ollama"

    ```python
    from agenticx.llms import OllamaProvider

    llm = OllamaProvider(
        model="ollama/qwen2.5:7b",
        base_url="http://127.0.0.1:11434",
    )
    resp = llm.invoke("Ping")
    ```

=== "MiniMax"

    ```python
    from agenticx.llms import MinimaxProvider

    llm = MinimaxProvider(
        model="MiniMax-M2.5",
        api_key="...",
        # base_url defaults to https://api.minimax.chat/v1
    )
    resp = llm.invoke("Reply with OK.")
    ```

=== "LiteLLM"

    ```python
    from agenticx.llms import LiteLLMProvider

    # Example: third-party OpenAI-compatible endpoint (e.g. SiliconFlow)
    llm = LiteLLMProvider(
        model="openai/Qwen/Qwen2.5-7B-Instruct",
        api_key="...",
        base_url="https://api.siliconflow.cn/v1",
    )
    resp = llm.invoke("Hello")
    ```

## Auth profile rotation

`AuthProfileManager` (`agenticx.llms.auth_profile`) rotates multiple API keys (or logical profiles) for the same provider. It persists cooldown metadata to a JSON file (atomic write via `.tmp` then replace).

- **`get_current()`** — picks the next usable profile (available first, ordered by `last_used`; cooling profiles queued by `cooldown_until`).
- **`mark_success(profile_name)`** — clears error state and cooldown timestamps for that profile.
- **`mark_failure(profile_name, failure_type)`** — increments `error_count`, sets `failure_type`, and applies exponential backoff to `cooldown_until`.
- **`classify_failure(exc)`** — maps exceptions to `billing`, `auth`, `rate_limit`, or `other` using message heuristics.

Backoff (implemented in `_compute_cooldown_ms`):

| Failure bucket | Base | Cap | Multiplier per step |
|----------------|------|-----|---------------------|
| `billing` | 5 hours | 24 hours | `2 ** min(error_count - 1, 10)` |
| `rate_limit`, `auth`, `other`, … | 60 seconds | 1 hour | `5 ** min(error_count - 1, 3)` |

`BaseLLMProvider.invoke_with_profile(messages, api_key=...)` forwards to `invoke(..., api_key=api_key)` so callers (for example `AgentExecutor`) can inject the rotated secret without replacing the provider instance.

!!! tip
    Pass `persistence_path=Path("~/.agenticx/auth_profiles.json").expanduser()` if cooldowns must survive process restarts.

## Failover routing

`FailoverProvider` wraps **two** providers: a primary and a fallback. For each of `invoke`, `ainvoke`, `stream`, `astream`, and `stream_with_tools`, it tries the primary unless the primary is in cooldown.

- **`failure_threshold`** (default `3`) — consecutive primary failures before entering cooldown.
- **`cooldown_duration`** (default `60` seconds) — primary bypass window after the threshold is hit.
- A successful primary call resets the failure counter and clears cooldown.

```python
from agenticx.llms import FailoverProvider, OpenAIProvider, AnthropicProvider

llm = FailoverProvider(
    primary=OpenAIProvider(model="gpt-4o", api_key="..."),
    fallback=AnthropicProvider(model="anthropic/claude-sonnet-4-20250514", api_key="..."),
    failure_threshold=3,
    cooldown_duration=120.0,
)
```

## Response cache

`ResponseCache` is an **in-memory** store keyed by SHA-256 (truncated) of the **string** prompt. Entries carry a TTL (`ttl_seconds`, default `300`) and LRU eviction (`max_entries`, default `100`). It is **not** wired automatically into `LiteLLMProvider`; wrap calls when you want cheaper dev loops.

```python
from agenticx.llms import OpenAIProvider, ResponseCache

llm = OpenAIProvider(model="gpt-4o-mini", api_key="...")
cache = ResponseCache(ttl_seconds=300, max_entries=100)

def cached_invoke(text: str):
    hit = cache.get(text)
    if hit is not None:
        return hit
    out = llm.invoke(text)
    cache.put(text, out)
    return out
```

`stats()` exposes hits, misses, size, and hit rate.

## Transcript sanitizer

Before model calls, `agent_runtime` runs `_sanitize_context_messages` on chat history. The pipeline is provider-aware in the broader sense that it enforces **valid assistant / tool message chains** so upstream APIs do not see orphaned `tool` rows or dangling `tool_calls`.

Behavior (simplified):

- **`tool` messages** are kept only when their `tool_call_id` appears on a preceding assistant `tool_calls` list that is fully satisfied by contiguous tool responses.
- **Assistant messages with `tool_calls`** are kept only when every call id has a matching tool response in history; otherwise `tool_calls` are stripped and text content is preserved.

This reduces provider `400` errors from broken tool loops after edits, retries, or partial persistence.

## Vision and image input

Multimodal content is honored when the backend and model support it. MiniMax’s **M2 chat family** (including M2, M2.1, M2.5, M2.7 and `*-highspeed` SKUs; excluding ids containing `vl` / `vision`) **does not** accept image or audio input per vendor constraints.

Studio strips `image_inputs` for those models before the completion request. Prefer a vision-capable model if attachments must reach the LLM.

!!! warning "MiniMax M2 and attachments"
    Do not assume the model sees images when using `minimax-m2*` IDs. The framework removes image payloads for that family and you should treat the turn as text-only unless you switch model.

## Provider configuration (environment variables)

Values below are the ones AgenticX’s config loader commonly pairs with `providers.<name>` in `~/.agenticx/config.yaml`. LiteLLM may read additional variables depending on the model id (for example `GEMINI_API_KEY`, `GROQ_API_KEY`).

| Variable | Used for |
|----------|-----------|
| `OPENAI_API_KEY` | OpenAI |
| `OPENAI_API_BASE` | OpenAI-compatible override (optional) |
| `ANTHROPIC_API_KEY` | Anthropic |
| `ANTHROPIC_API_BASE` | Anthropic base URL override (optional) |
| `ZHIPU_API_KEY` | Zhipu |
| `ARK_API_KEY` | VolcEngine Ark (`volcengine` / `ark` provider) |
| `VOLCENGINE_ACCESS_KEY`, `VOLCENGINE_SECRET_KEY` | Alternate Ark / Volcengine auth paths (when configured) |
| `DASHSCOPE_API_KEY` | Alibaba Bailian / Dashscope |
| `QIANFAN_ACCESS_KEY` | Baidu Qianfan (`secret_key` often set in YAML) |
| `MOONSHOT_API_KEY` | Kimi / Moonshot |
| `MINIMAX_API_KEY` | MiniMax |
| `AGX_MAX_TOOL_ROUNDS` | Runtime cap on tool rounds (global) |
| `AGX_CHROMIUM_QUIET` | Desktop Chromium log noise (optional) |

Ollama is usually configured with `base_url` in YAML (for example `http://localhost:11434`); keys are not required for local inference.

!!! tip
    Resolve providers in one line with `ProviderResolver.resolve()` when you want the merged file config instead of manual constructors.
