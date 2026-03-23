# Hook System

## Overview

AgenticX exposes **two hook layers** for different execution surfaces:

| Layer | Package path | Purpose |
|-------|----------------|---------|
| **Core hooks** | `agenticx/core/hooks/` | Synchronous interception around **LLM** and **tool** calls in flows that use the core hook registry (for example workforce collaboration and server event wiring). Hooks see a shared context object and can **mutate** inputs or **block** the call. |
| **Runtime hooks** | `agenticx/runtime/hooks/` | **Async** lifecycle hooks on **`AgentRuntime`** (Studio server path): model rounds, tool execution, compaction, and end-of-turn callbacks. Suited to observability, policy, and memory side effects in the streaming runtime. |

Hooks let you observe, enforce policy, redact or reshape prompts and tool arguments, and attach telemetry without forking the executor. They run **around** the same turn loop the agent already uses: before expensive work (LLM or tool), and after results are available.

!!! note "Parallel package `agenticx.hooks`"
    The class `AgentExecutor` in `agenticx/core/agent_executor.py` imports hook types and executors from **`agenticx.hooks`** (top-level package), which defines related but **not identical** context dataclasses (for example `tool_input` / `tool_result`, `iterations`, `model_name`). When integrating with `AgentExecutor` directly, follow that package’s types and docstrings. The rest of this page documents **`agenticx.core.hooks`**, which is what modules such as `agenticx.collaboration.workforce` use.

---

## Core Hooks (`agenticx/core/hooks/`)

Core hooks are plain **callables** registered **globally** or on an **`Agent`** instance. They run in a fixed order: **all global hooks first**, then **agent-level** lists.

### LLM hooks (`llm_hooks.py`)

Context type: **`LLMCallHookContext`** (`agenticx/core/hooks/types.py`).

**Before call (inputs):**

| Field | Description |
|-------|-------------|
| `agent_id` | Agent identifier |
| `task_id` | Optional task id |
| `messages` | Message list (may be mutated in place before the call) |
| `model` | Optional model name |
| `temperature` | Optional sampling temperature |
| `max_tokens` | Optional cap |
| `iteration` | Loop iteration index |
| `timestamp` | When the hook ran |

**After call (populated by the integration point):**

| Field | Description |
|-------|-------------|
| `response` | LLM response payload |
| `tokens_used` | Optional token count |
| `cost` | Optional cost |
| `duration_ms` | Optional latency |
| `error` | Optional exception |

**Registration and execution**

- `register_before_llm_call_hook(hook)` / `register_after_llm_call_hook(hook)` add **global** hooks.
- `execute_before_llm_call_hooks(context, agent_hooks=None)` runs globals, then optional agent-level hooks. Any hook returning **`False`** stops the chain and signals **do not call the LLM**.
- `execute_after_llm_call_hooks(context, agent_hooks=None)` runs globals then agent hooks; return value is a **boolean** aggregate for pipeline control (see source for exact semantics).
- `clear_all_llm_hooks()` clears **global** before/after lists (mainly tests).
- `unregister_before_llm_call_hook` / `unregister_after_llm_call_hook` remove a specific global hook.

!!! tip "Mutating `messages`"
    Prefer **in-place** updates to `context.messages` in `before` hooks so the downstream caller sees the same list reference.

### Tool hooks (`tool_hooks.py`)

Context type: **`ToolCallHookContext`**.

**Before call:**

| Field | Description |
|-------|-------------|
| `agent_id` | Agent identifier |
| `task_id` | Optional task id |
| `tool_name` | Tool being invoked |
| `tool_args` | Argument dict (may be mutated in place) |
| `iteration` | Loop iteration |
| `timestamp` | When the hook ran |

**After call:**

| Field | Description |
|-------|-------------|
| `result` | Tool result |
| `success` | Whether execution succeeded |
| `duration_ms` | Optional latency |
| `error` | Optional exception |

**Registration and execution**

- `register_before_tool_call_hook` / `register_after_tool_call_hook` for globals.
- `execute_before_tool_call_hooks(context, agent_hooks=None)` runs globals then agent hooks; **`False`** from any hook **blocks** the tool call.
- `execute_after_tool_call_hooks` runs after execution with filled context.
- `clear_all_tool_hooks()` clears global tool hooks.
- Unregister helpers mirror the LLM API.

### Two-level management: global + agent

`Agent` (`agenticx/core/agent.py`) carries optional:

- `llm_hooks: Optional[Dict[str, List[Callable]]]` with keys **`"before"`** and **`"after"`**
- `tool_hooks: Optional[Dict[str, List[Callable]]]` with the same keys

Global registrations apply to every agent that goes through the same execution path; agent-level lists add per-agent behavior without touching process-wide state.

---

## Runtime Hooks (`agenticx/runtime/hooks/`)

Runtime hooks are **async** methods on subclasses of **`AgentHook`**, coordinated by **`HookRegistry`** on **`AgentRuntime`** (`self.hooks`).

### `AgentHook` base class (`hooks/__init__.py`)

Override only what you need. Default implementations return `None` / no-op.

| Method | Role |
|--------|------|
| `before_model(messages, session)` | Optional transform: return a new message sequence to replace the one passed in. |
| `after_model(response, session)` | Observe or side-effect after the model returns. |
| `before_tool_call(tool_name, arguments, session)` | Return **`HookOutcome(blocked=True, reason="...")`** to veto the tool; otherwise `None`. |
| `after_tool_call(tool_name, result, session)` | Optional string to **replace** the tool result seen by the runtime. |
| `on_compaction(compacted_count, summary, session)` | After context compaction. |
| `on_agent_end(final_text, session)` | End of agent turn. |

### `HookRegistry`

- `register(hook: AgentHook, *, priority: int = 0)` stores hooks and sorts by **`priority` descending** (higher number runs **earlier**).
- `run_before_tool_call(tool_name, arguments, session) -> HookOutcome`: walks hooks in order; first **`blocked=True`** outcome wins and **prevents** tool execution.
- Other `run_*` helpers apply the same ordering for model and lifecycle events.

### `HookOutcome`

```python
@dataclass
class HookOutcome:
    blocked: bool = False
    reason: str = ""
```

### `MemoryHook` (`hooks/memory_hook.py`)

Built-in hook registered on `AgentRuntime` with **`priority=-10`** so it runs **after** higher-priority hooks during `run_on_agent_end` (registry sorts descending, so `-10` is late).

Behavior summary:

- Runs in **`on_agent_end`** when `len(chat_history) >= MIN_CHAT_TURNS * 2` (default **`MIN_CHAT_TURNS = 3`**, i.e. **six messages**).
- Heuristic extraction (no extra LLM call), up to **`MAX_FACTS_PER_SESSION` (8)** lines from recent history.
- Appends to **`memory/<YYYY-MM-DD>.md`** under the session workspace (and a short subset to **`MEMORY.md`** when under size limits).
- **`_maybe_compact_daily()`**: if today’s daily file exceeds **2000** characters, collapses duplicate bullet lines using a normalized key (prefix of each bullet) to shrink the file.

---

## Usage examples

### Core: global LLM audit

```python
from agenticx.core.hooks import (
    LLMCallHookContext,
    register_before_llm_call_hook,
    register_after_llm_call_hook,
)


def log_before_llm(ctx: LLMCallHookContext) -> bool:
    # Mutate ctx.messages in place if needed, e.g. inject a system reminder.
    return True  # False blocks the LLM call


def log_after_llm(ctx: LLMCallHookContext) -> bool:
    if ctx.error:
        # Record ctx.error, metrics, etc.
        pass
    return True


register_before_llm_call_hook(log_before_llm)
register_after_llm_call_hook(log_after_llm)
```

### Core: per-agent tool gate

```python
from agenticx.core.agent import Agent
from agenticx.core.hooks.types import ToolCallHookContext


def no_delete(ctx: ToolCallHookContext) -> bool:
    if ctx.tool_name == "filesystem_delete":
        return False
    return True


agent = Agent(
    name="safe-bot",
    role="assistant",
    goal="Help without deleting files",
    tool_hooks={"before": [no_delete], "after": []},
)
```

### Runtime: block a tool from `AgentHook`

```python
from agenticx.runtime.hooks import AgentHook, HookOutcome


class DenyShellHook(AgentHook):
    async def before_tool_call(self, tool_name, arguments, session):
        if tool_name in {"run_terminal_cmd", "bash"}:
            return HookOutcome(blocked=True, reason="Shell tools disabled in this session")
        return None
```

Attach after constructing `AgentRuntime` (or pass a pre-built `HookRegistry`):

```python
runtime.hooks.register(DenyShellHook(), priority=100)
```

---

## Core vs Runtime hooks

| Aspect | Core (`agenticx/core/hooks/`) | Runtime (`agenticx/runtime/hooks/`) |
|--------|-------------------------------|-------------------------------------|
| **Execution model** | Synchronous callables | `async` methods on `AgentHook` |
| **Primary integration** | Workforce / server paths using `agenticx.core.hooks`; parallel `agenticx.hooks` for `AgentExecutor` | `AgentRuntime` (Studio / streaming server) |
| **Block LLM** | `before` hook returns `False` | Transform or policy in `before_model` (no single global “block” flag; implement by altering messages or upper-layer logic) |
| **Block tool** | `before` hook returns `False` | `HookOutcome(blocked=True)` from `before_tool_call` |
| **Registry** | Module-level lists + `Agent.llm_hooks` / `Agent.tool_hooks` | `HookRegistry` with numeric **priority** (higher first) |
| **Clear globals** | `clear_all_llm_hooks`, `clear_all_tool_hooks` | Replace or extend `HookRegistry` on the runtime instance |
| **Typical uses** | Logging, policy, prompt/arg rewriting in core-aligned executors | Streaming lifecycle, compaction hooks, `MemoryHook`, session-scoped policy |

For memory-focused behavior tied to Studio sessions, see also [Memory System](memory.md).
