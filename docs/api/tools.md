# agenticx.tools

English API reference for the AgenticX tool stack: base abstractions, function tools, built-ins, execution pipeline, MCP integration, OpenAPI-derived tools, skills, credentials, windowed file access, and unified document handling.

Primary import surface:

```python
from agenticx.tools import (
    BaseTool,
    ToolError,
    tool,
    FunctionTool,
    ToolExecutor,
    FileTool,
    WebSearchTool,
    # ... see agenticx.tools.__all__
)
```

!!! note "Source of truth"
    Types and behavior may evolve; confirm against the `agenticx/tools/` package on the branch you use.

---

## BaseTool (abstract base class)

`BaseTool` lives in `agenticx.tools.base`. Subclasses implement synchronous and asynchronous execution hooks.

### Fields and schema

| Member | Type | Description |
|--------|------|-------------|
| `name` | `str` | Tool identifier; defaults to class name if omitted in `__init__`. |
| `description` | `str` | Human-readable description; defaults to docstring or a fallback string. |
| `args_schema` | `Optional[Type[pydantic.BaseModel]]` | Pydantic model for arguments. Serialized to JSON Schema via `model_json_schema()` / `get_declaration()`. |
| `timeout` | `Optional[float]` | Per-tool timeout in seconds. |
| `organization_id` | `Optional[str]` | Tenant scope for credential lookup and multi-tenant tools. |

Exposed JSON/OpenAI-style parameters are derived from `args_schema`:

- `get_declaration()` returns `{ "name", "description", "parameters" }` with a JSON Schema object.
- `to_openai_schema()` returns the `function` wrapper expected by many chat-completions APIs.

### Execution and LLM hooks

| Method | Role |
|--------|------|
| `run(**kwargs) -> Any` | Public sync entry: validates args, invokes `_run`, handles callbacks and timeout. |
| `arun(**kwargs) -> Any` | Public async entry: validates args, invokes `_arun`. |
| `_run(**kwargs) -> Any` | **Abstract.** Sync implementation. |
| `_arun(**kwargs) -> Any` | Default runs `_run` in a thread pool; override for native async I/O. |
| `validate_bash_syntax(cmd: str) -> None` | Optional helper: runs `bash -n`; raises `ToolValidationError` on failure. |
| `process_llm_request(tool_context, llm_request) -> None` | Optional hook (ADK-style): e.g. append `to_openai_schema()` to `llm_request.tools`. |

!!! tip "Naming: `execute` / `aexecute` vs `run` / `arun`"
    On `BaseTool`, the public methods are **`run`** and **`arun`**. **`ToolExecutor`** (below) exposes **`execute`** and **`aexecute`** that take a `BaseTool` instance plus kwargs.

### Human approval

`BaseTool` does **not** define a `required_approval` field. Gated execution uses `agenticx.tools.security.human_in_the_loop` and `ApprovalRequiredError`; `ToolExecutor` re-raises `ApprovalRequiredError` without treating it as a failed retry.

### ToolError hierarchy

| Class | Meaning |
|-------|---------|
| `ToolError` | Base exception; `message`, `tool_name`, optional `details`. |
| `ToolTimeoutError` | Execution exceeded timeout. |
| `ToolValidationError` | Argument or pre-check validation failed. |

---

## `@tool` decorator and `FunctionTool`

Defined in `agenticx.tools.function_tool`.

The `@tool` decorator builds a `FunctionTool` that:

1. Reads the function **name** (unless overridden).
2. Parses the **docstring** with `docstring_parser` for short/long description and per-parameter descriptions.
3. Builds a **Pydantic model** from the signature and **type hints** (`typing.get_type_hints`); required vs optional follows defaults.

```python
from agenticx.tools import tool

@tool(name="add", timeout=10.0)
def add_numbers(a: int, b: int) -> int:
    """Add two integers.

    Args:
        a: First summand.
        b: Second summand.

    Returns:
        Sum of a and b.
    """
    return a + b

# Sync call path on the tool instance
result = add_numbers.run(a=1, b=2)

# Or use create_tool(fn) for the same without decorator syntax
from agenticx.tools.function_tool import create_tool
t = create_tool(add_numbers)
```

Async functions are supported: call `arun` (or run under an async executor via `ToolExecutor.aexecute`).

---

## Built-in tools

Implemented in `agenticx.tools.builtin`. Convenience factory: `get_builtin_tools(organization_id=..., allowed_file_paths=...)`.

| Class | Purpose |
|-------|---------|
| `FileTool` | Read/write files via `action` dispatch (`read` / `write`) with `FileReadArgs` / `FileWriteArgs`. |
| `WebSearchTool` | Search: tries **Google Custom Search** when credentials exist (`web_search` / `api_key` + `search_engine_id`), else **DuckDuckGo** HTTP API. |
| `CodeInterpreterTool` | Runs Python in `SandboxEnvironment` (restricted `exec` sandbox). |
| `HttpRequestTool` | Generic `requests` wrapper; response body truncated for safety. |
| `JsonTool` | `parse` / `format` / `validate` actions on string payloads. |

### Safety: `allowed_paths` and `SandboxEnvironment`

- **`FileTool`**: Constructor accepts `allowed_paths: Optional[List[str]]`. If non-empty, paths must resolve under an allowed prefix; also enforces `max_file_size` (default 10 MiB).
- **`WindowedFileTool`**: Same idea with resolved `allowed_paths` (see below).
- **`SandboxEnvironment`** (`agenticx.tools.executor`): Used by `CodeInterpreterTool` for in-process sandboxing—allowlisted imports, keyword blocklist, no arbitrary OS/subprocess access. For stronger isolation, use **`ToolExecutor`** with **`SandboxConfig`** and `execute_code_in_sandbox` (process/container backends).

---

## ToolExecutor

Defined in `agenticx.tools.executor`.

### Constructor parameters

| Parameter | Description |
|-----------|-------------|
| `max_retries` | Retry count for transient failures (default `3`). |
| `retry_delay` | Delay between retries in seconds. |
| `default_timeout` | Fallback timeout if the tool has none. |
| `enable_sandbox` | If `True`, attaches a simple `SandboxEnvironment` on the executor (legacy path). |
| `sandbox_config` | Optional `SandboxConfig` for advanced sandbox (`subprocess` / `microsandbox` / `docker` / `auto`). |
| `policy_stack` | Optional declarative policy; `check(tool.name)` before run. |
| `safety_layer` | Optional `SafetyLayer` (`agenticx.safety.layer`) for input validation and output sanitization. |

There is **no** `tools: List[BaseTool]` argument; pass the tool instance on each `execute` / `aexecute` call.

### Execution pipeline

When `safety_layer` is set:

1. **Input**: `safety_layer.validate_tool_input(tool_name, kwargs)`; blocking violations raise `ToolError`.
2. **Run**: `tool.run(**kwargs)` or `await tool.arun(**kwargs)`.
3. **Output**: If the result is a `str`, `safety_layer.sanitize_tool_output(result, tool_name=...)` runs on success.
4. **Audit**: `_record_tool_call` appends a `ToolCallingRecord` (cap ~1000 entries).

Optional `tool.post_state_hook()` may run after success; return value is stored on `ExecutionResult.state` (async hooks supported in `aexecute`).

### Batch execution

```python
results = executor.execute_batch([(tool_a, {"x": 1}), (tool_b, {"y": 2})])

results = await executor.aexecute_batch(
    [(tool_a, {"x": 1}), (tool_b, {"y": 2})],
    concurrent=True,
)
```

`aexecute_batch(..., concurrent=False)` runs sequentially.

### ToolCallingRecord

| Field | Description |
|-------|-------------|
| `tool_name` | Name of the tool. |
| `tool_args` | Arguments dict (maps to conceptual `args` in tracing UIs). |
| `agent_id`, `task_id` | Optional correlation IDs passed into `execute` / `aexecute`. |
| `timestamp` | `datetime` of the call. |
| `success` | Whether execution succeeded. |
| `result` | Return value on success. |
| `error` | String message on failure. |
| `execution_time` | **Seconds** (float); multiply by `1000` for milliseconds. |
| `retry_count` | Number of retries consumed. |

### `get_tool_calling_history`

```python
records = executor.get_tool_calling_history(
    agent_id="agent-1",
    task_id="task-42",
    tool_name="file_tool",
    limit=100,
)
```

Returns the **last** `limit` matching records from in-memory history.

### SandboxConfig

| Field | Description |
|-------|-------------|
| `backend` | `"auto"`, `"subprocess"`, `"microsandbox"`, or `"docker"`. |
| `template_name`, `timeout_seconds`, `cpu`, `memory_mb` | Resource and timeout hints for sandbox template. |
| `network_enabled`, `auto_cleanup` | Network policy and lifecycle. |

### ExecutionResult

| Attribute | Description |
|-----------|-------------|
| `tool_name` | Executed tool. |
| `success` | Outcome flag. |
| `result` | Tool return value. |
| `error` | Exception object on failure. |
| `execution_time` | Seconds (float). |
| `retry_count` | Retries used. |
| `state` | Optional payload from `post_state_hook`. |

---

## MCPHub and MCPClientV2

### MCPClientV2

`agenticx.tools.remote_v2.MCPClientV2` uses the official MCP Python SDK: **`stdio_client`** spawns a **child process** and keeps a **persistent `ClientSession`**. Requires optional dependency (e.g. `pip install "agenticx[mcp]"`).

Typical configuration uses `MCPServerConfig`: `name`, `command`, `args`, `env`, `timeout`, optional `cwd`, `enabled_tools`, `assign_to_agents`.

### MCPHub

`agenticx.tools.mcp_hub.MCPHub` aggregates multiple `MCPClientV2` instances.

```python
from agenticx.tools.mcp_hub import MCPHub, MCPHubConfig
from agenticx.tools.remote_v2 import MCPServerConfig

config = MCPHubConfig(
    servers=[
        MCPServerConfig(name="demo", command="npx", args=["-y", "@modelcontextprotocol/server-filesystem", "/tmp"]),
    ],
    auto_mode=True,
)
hub = MCPHub.from_config(config)

# Discover merged tool list (async)
infos = await hub.discover_all_tools()

# When auto_mode=True, wrap as BaseTool instances for agents
tools = await hub.get_tools_for_agent()

await hub.close()
```

Name collisions are resolved with routed names (e.g. `server__tool`). `call_tool` routes to the correct client; `extract_tool_result` normalizes MCP content blocks.

!!! warning "Optional imports"
    If MCP extras are missing, `MCPClientV2` / `MCPHub` may be unavailable at import time; guard imports or install MCP dependencies.

---

## OpenAPIToolset and RestApiTool

`agenticx.tools.openapi_toolset`.

| Class | Role |
|-------|------|
| `OpenAPIToolset` | Loads OpenAPI 2/3 specs and materializes a set of `RestApiTool` instances. |
| `RestApiTool` | Single-operation HTTP client built on **httpx** (required). |

Factory methods:

```python
from agenticx.tools.openapi_toolset import OpenAPIToolset

toolset = OpenAPIToolset.from_url("https://api.example.com/openapi.json")
toolset = OpenAPIToolset.from_file("/path/to/openapi.yaml")

tools = toolset.get_tools()
subset = toolset.get_tools(operations=["getUser"], tags=["users"], methods=["GET"])
```

!!! note "httpx"
    Install `httpx` for `RestApiTool` / OpenAPI-generated calls.

---

## SkillBundleLoader, SkillTool, SkillMetadata

Session-level (and project-level) **skill injection** follows Anthropic-style `SKILL.md` bundles.

| Type | Role |
|------|------|
| `SkillMetadata` | `name`, `description`, `base_dir`, `skill_md_path`, `location`, optional `SkillGate`. |
| `SkillBundleLoader` | Scans standard skill directories (e.g. `.agents/skills`, `.claude/skills`), parses YAML frontmatter, applies gates (`check_skill_gate`). |
| `SkillTool` | `BaseTool` with `action`: `list` / `read`; uses `process_llm_request` for progressive disclosure into the LLM request. |

```python
from agenticx.tools import SkillBundleLoader, SkillTool

loader = SkillBundleLoader()
loader.scan()
tool = SkillTool(loader=loader, auto_scan=True)
text = tool.run(action="list")
```

---

## CredentialStore

`agenticx.tools.credentials.CredentialStore` stores JSON-serialized secrets on disk (default under `~/.agenticx/credentials`), optionally **encrypted with Fernet** (`cryptography` package). A key file is created at `~/.agenticx/encryption.key` when encryption is enabled.

**Multi-tenant layout:** top-level dict keyed by **`organization_id`**, then by **`tool_name`** (e.g. `"web_search"` for Google API key + search engine id).

```python
from agenticx.tools import CredentialStore
from agenticx.tools.credentials import get_credential, set_credential

store = CredentialStore()
store.set_credential("org-1", "web_search", {"api_key": "...", "search_engine_id": "..."})
data = store.get_credential("org-1", "web_search")

# Module-level helpers use the process-wide default store
set_credential("org-1", "api_x", {"token": "..."})
get_credential("org-1", "api_x")
```

---

## WindowedFileTool

`agenticx.tools.windowed.WindowedFileTool` reads large files in **line windows** (default 100 lines).

Actions (enum `WindowAction`):

- `open` — requires `file_path`; optional `line`, `window_size`.
- `goto` — jump to `line` in the currently opened file.
- `scroll_up` / `scroll_down` — optional `delta` lines.

Constructor: `window_size`, `allowed_paths` (resolved prefixes, same security model as `FileTool`).

---

## DocumentRouter and UnifiedDocumentTool

`agenticx.tools.document_routers.DocumentRouter` maps **extensions** or **URLs** to callables returning `(success, content)`.

`create_default_router()` builds a router with sensible defaults.

`agenticx.tools.unified_document.UnifiedDocumentTool` exposes one tool with `document_path` (local path or URL). It uses an internal `DocumentRouter`, optional **Firecrawl** / **Chunkr** flags, and a `cache_dir` for downloaded assets.

```python
from agenticx.tools import UnifiedDocumentTool, DocumentRouter, create_default_router

router = create_default_router()
tool = UnifiedDocumentTool(router=router, cache_dir="./cache")
```

---

## See also

- [Source tree: `agenticx/tools`](https://github.com/DemonDamon/AgenticX/tree/main/agenticx/tools)
- Safety layer: `agenticx.safety.layer.SafetyLayer`
- Advanced sandbox: `agenticx.sandbox` (used by `SandboxConfig` / `ToolExecutor.execute_code_in_sandbox`)
