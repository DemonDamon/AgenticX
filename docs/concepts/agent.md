# Agent runtime

This page describes the **`AgentRuntime`** execution path in AgenticX (`agenticx/runtime/agent_runtime.py`): the think-act loop, event stream, timeouts, confirmation gates, compaction, loop detection, and hook points. It is distinct from the older **`AgentExecutor`** pipeline in `agenticx/core/agent_executor.py`, which uses its own event log and context compiler.

---

## Agent definition (`Agent` model)

The primary agent record is `agenticx.core.agent.Agent` (Pydantic `BaseModel`). Fields commonly used for persona and tenancy:

| Field | Type | Notes |
|-------|------|--------|
| `id` | `str` | Defaults to a new UUID if omitted. |
| `name` | `str` | Display name. |
| `role` | `str` | Role description for prompts. |
| `goal` | `str` | Primary objective. |
| `backstory` | `str \| None` | Optional persona context. |
| `organization_id` | `str` | Multi-tenant namespace; default `"default-org"`. |

The model also carries tools, LLM hooks, `max_iterations` (default **25**), `max_retry_limit`, and related configuration. There is **no** `verbose` boolean on `Agent`, and there is **no** field named `max_iter`—iteration limits for the **runtime tool loop** are configured separately (see [Runtime configuration](#runtime-configuration)).

!!! note "`max_iter` / `verbose`"
    If you see `max_iter` or `verbose` in examples targeting **`AgentRuntime`**, map `max_iter` mentally to **`max_iterations`** on `Agent` for the core executor, or to **`AGX_MAX_TOOL_ROUNDS`** / `AgentRuntime(..., max_tool_rounds=...)` for the Studio loop. `verbose` is not part of the `Agent` schema.

---

## Running an agent (`AgentExecutor`)

`agenticx.core.agent_executor.AgentExecutor` is the control-flow engine for **`Agent` + `Task`**: it builds prompts, calls the configured `BaseLLMProvider`, parses actions, runs `BaseTool` instances (including parallel batches), applies GuideRails, and can compact context via **`ContextCompiler.maybe_compact`** on an internal event log.

Typical usage:

```python
from agenticx.core.agent import Agent
from agenticx.core.agent_executor import AgentExecutor
from agenticx.core.task import Task
from agenticx.llms import OpenAIProvider

agent = Agent(
    name="Research Assistant",
    role="Analyst",
    goal="Summarize findings",
    organization_id="my-org",
)
task = Task(
    id="t1",
    description="Research topic X",
    expected_output="Short report",
)
executor = AgentExecutor(llm_provider=OpenAIProvider(model="gpt-4o"))
result = executor.run(agent=agent, task=task)
```

`AgentExecutor.__init__` accepts `max_iterations` (default **50**), independent of `Agent.max_iterations`.

!!! info "Two stacks"
    **`AgentRuntime`** drives the Studio/Desktop chat path (OpenAI-style messages, `STUDIO_TOOLS`, SSE-friendly `RuntimeEvent`s). **`AgentExecutor`** drives the classic task/agent pipeline. Both are valid; this page focuses on **`AgentRuntime`** below.

---

## The think-act loop (`AgentRuntime.run_turn`)

Each user turn runs **`AgentRuntime.run_turn`**, which loops at most **`max_tool_rounds`** times. One round is:

1. **Message sanitization** — `_sanitize_context_messages` repairs history so every `assistant` message with `tool_calls` is followed by matching `tool` rows (by `tool_call_id`). Orphan tool rows and dangling `tool_calls` are dropped so providers do not return HTTP 400 on broken sequences.
2. **Context compaction** — `ContextCompactor.maybe_compact` may replace older history with a single `system` summary message (see [Context compaction](#context-compaction)). On success, a **`COMPACTION`** event is emitted and **`on_compaction`** hooks run.
3. **LLM call** — If `llm.stream_with_tools` exists and succeeds, the runtime streams **content** and **tool_call_delta** chunks in a worker thread, enforces **first-feedback**, **invoke**, **heartbeat**, and **hard** timeouts (see [Timeout configuration](#timeout-configuration)), normalizes invalid tool names (e.g. `"None"`), and repairs streamed JSON arguments. On any failure, it **falls back** to **`llm.invoke`** with `tools`, `tool_choice="auto"` (with MiniMax-specific retries). **`run_before_model`** / **`run_after_model`** hooks wrap the call.
4. **Tool-call filtering** — Parsed `tool_calls` drop empty names and `name.lower() == "none"`. If the model returns no native tool calls, the runtime may extract an **inline** tool call from plaintext when it matches the allowed tool set.
5. **Tool dispatch** — For each call: **`run_before_tool_call`** may block. Unknown tools and invalid names produce **`TOOL_RESULT`** (and often **`ERROR`**) without executing. Tools in **`_meta_only_names`** go through **`dispatch_meta_tool_async`** (requires `team_manager`); all others use **`dispatch_tool_async`** with the runtime **`confirm_gate`**. Nested tool events from the dispatcher are re-yielded as **`RuntimeEvent`s** (e.g. subagent lifecycle). After execution, **`run_after_tool_call`** may rewrite the result string.
6. **Loop detection** — After each executed tool, **`LoopDetector.record_call`** / **`check`** run. **Warning** level injects a user-role reminder into `messages`; **critical** level emits **`ERROR`** and ends the turn.

If the model returns text and no tools, the runtime streams final text if needed, runs **`run_on_agent_end`**, yields **`FINAL`**, and returns. If **`max_tool_rounds`** is exhausted without a final answer, **meta** agents get **`ERROR`**; non-meta agents get **`SUBAGENT_PAUSED`** with checkpoint metadata.

---

## Runtime event stream (`EventType`)

`agenticx/runtime/events.py` defines the string enum consumed by Studio and tests:

| `EventType` | Value | Role |
|-------------|--------|------|
| `ROUND_START` | `round_start` | New tool round; payload includes `round`, `max_rounds`. |
| `TOKEN` | `token` | Streamed model text (or first-idle waiting pulse from the runtime). |
| `TOOL_CALL` | `tool_call` | Tool name, arguments, `tool_call_id`. |
| `TOOL_RESULT` | `tool_result` | Tool output string (including synthetic errors for blocked/unknown tools). |
| `CONFIRM_REQUIRED` | `confirm_required` | Emitted when a tool asks for confirmation and an event callback is wired (see `agenticx/cli/agent_tools.py` `_confirm`). |
| `CONFIRM_RESPONSE` | `confirm_response` | Emitted after the gate resolves with `approved` boolean. |
| `COMPACTION` | `compaction` | History was compacted; includes `compacted_count`, `summary`. |
| `SUBAGENT_CHECKPOINT` | `subagent_checkpoint` | Periodic progress for non-meta agents (every 8 rounds). |
| `SUBAGENT_PAUSED` | `subagent_paused` | Sub-agent hit max rounds without finishing. |
| `FINAL` | `final` | Terminal natural-language reply for the turn. |
| `ERROR` | `error` | Failure, user stop, timeout, or loop guard abort. |
| `SUBAGENT_STARTED` | `subagent_started` | Delegation started (e.g. meta tools / team manager). |
| `SUBAGENT_PROGRESS` | `subagent_progress` | Mid-run subagent updates. |
| `SUBAGENT_COMPLETED` | `subagent_completed` | Subagent finished successfully. |
| `SUBAGENT_ERROR` | `subagent_error` | Subagent failed. |

---

## Timeout configuration

Resolved in **`agent_runtime.py`** via environment variables (and optional `ConfigManager` keys). Values are **seconds**.

| Variable | Default | Role |
|----------|---------|------|
| `AGX_LLM_INVOKE_TIMEOUT_SECONDS` | **120** | Idle budget **before** the first streamed chunk (streaming) or total wait for **`invoke`** completion (non-streaming path). |
| `AGX_LLM_HEARTBEAT_TIMEOUT_SECONDS` | **60** | Max idle time **between** streamed chunks after the first chunk. |
| `AGX_LLM_HARD_TIMEOUT_SECONDS` | **300** | Wall-clock cap for the streaming worker; stops the stream when exceeded. |
| `AGX_LLM_FIRST_FEEDBACK_SECONDS` | **8** | After this delay with no first chunk, the runtime may emit a short waiting **`TOKEN`** (provider-specific overrides exist for some vendors). |

The LLM request timeout passed into providers is derived as **`max(invoke, heartbeat, hard) + 15`** seconds.

---

## Confirm gate

| Class | Behavior |
|-------|-----------|
| **`ConfirmGate`** | Abstract `request_confirm(question, context) -> bool`. |
| **`SyncConfirmGate`** | Blocking **`input()`**; for CLI. |
| **`AsyncConfirmGate`** | Publishes a pending `Future`; server/UI resolves via **`resolve(request_id, approved)`**. Emits **`confirm_required`** / **`confirm_response`** when an event callback is used. |
| **`AutoApproveConfirmGate`** | Always returns **`True`**; used e.g. for delegated sub-agents that must not block on human input. **`last_request`** stays unset. |

**Run Everything** (Desktop permission mode **`auto`**) means the product treats risky operations as pre-approved for that session: confirmations should resolve without repeated prompts, consistent with auto-approval policy and **`AsyncConfirmGate.resolve(..., True)`** on the server when the user has chosen that mode.

---

## Context compaction

**`ContextCompactor.maybe_compact`** (`agenticx/runtime/compactor.py`):

- Triggers when history length **> `threshold_messages`** (default **20**, minimum **8**) **or** total character count **> `threshold_chars`** (default **48_000**).
- Keeps the last **`retain_recent_messages`** messages (default **8**, minimum **4**).
- Summarizes the prefix via **`llm.invoke`** on a Chinese prompt; on failure, falls back to truncated snippets.
- Returns a list starting with one **`system`** message tagged `[compacted] ...` plus retained tail messages.

---

## Loop detection

**`LoopDetector`** (`agenticx/runtime/loop_detector.py`) tracks recent `(tool_name, args_signature)` pairs and progress marks.

**`AgentRuntime`** constructs it with **`warning_threshold=4`** and **`critical_threshold=8`** (constructor arguments), **not** the class defaults (8 / 15). Detectors include:

- **generic_repeat** — same tool + same arguments repeated.
- **ping_pong** — alternating pattern on the tail.
- **no_progress** — many calls without artifacts/scratchpad progress or other heuristics.

**Warning** adds a reminder message; **critical** stops the run with **`ERROR`**.

---

## Runtime configuration

| Variable / knob | Default (Studio server) | Meaning |
|-----------------|------------------------|---------|
| `AGX_MAX_TOOL_ROUNDS` / `runtime.max_tool_rounds` | **30** if unset (clamped **10–120** in `studio/server.py`) | Max think-act rounds per user message. Bare **`AgentRuntime()`** uses Python default **10** unless overridden. |
| `AGX_STATUS_QUERY_BUDGET_PER_TURN` | **2** | Meta-agent budget for **`query_subagent_status`** per turn. |
| `AGX_STATUS_QUERY_COOLDOWN_SECONDS` | **8** | Minimum spacing between status queries for meta. |

---

## Events hook (`HookRegistry` / `AgentHook`)

Registered hooks (`agenticx/runtime/hooks/__init__.py`) run in priority order:

| Hook | When |
|------|------|
| **`before_model`** | After compaction/sanitization assembly, immediately before the LLM call. May replace the message list. |
| **`after_model`** | After a successful LLM response object is produced. |
| **`before_tool_call`** | Before dispatch; may **`block`** with a reason (synthetic tool error). |
| **`after_tool_call`** | May rewrite the tool result string. |
| **`on_compaction`** | After a successful compaction (mirrors **`COMPACTION`** event). |
| **`on_agent_end`** | Immediately before emitting **`FINAL`**, or when ending with max-round messages. |

`AgentRuntime` registers **`MemoryHook`** at low priority when available.

---

## Related

- [Orchestration](orchestration.md) — multi-step workflows and coordination.
- [Tools](tools.md) — tool definitions and dispatch.
- [Memory](memory.md) — long-horizon recall and hooks.
