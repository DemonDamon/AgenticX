# Tools

## Overview

Tools are the contract between language models and your environment. In AgenticX they sit between **agent reasoning** and **side effects**: filesystem, shell, MCP servers, generated REST calls, and packaged skills. The runtime collects tool schemas for the model, routes `tool_calls` back to implementations, and funnels execution through shared policy, safety, and auditing hooks.

| Concern | Primary components |
|--------|---------------------|
| Declaring tools | `@tool`, `FunctionTool`, `BaseTool` subclasses |
| Studio / workspace | `STUDIO_TOOLS` (OpenAI-style function schemas + dispatch) |
| External MCP | `MCPHub`, `MCPClientV2`, `RemoteTool` |
| Spec-driven HTTP APIs | `OpenAPIToolset` |
| Skill packages | `SkillBundleLoader`, `SkillTool` |
| Execution | `ToolExecutor` (`agenticx.tools.executor`) |
| Isolation hints | `SandboxPolicy`, `SandboxConfig` |

!!! note "Naming"
    The public Python API lives under `agenticx.tools` and `agenticx.safety`. Some older or adapter layers also reference `agenticx.core.executor.ToolExecutor`; prefer `agenticx.tools.executor.ToolExecutor` for sandbox, safety layer, and audit features described below.

## `@tool` decorator

Use `agenticx.tools.function_tool.tool` to turn a plain function into a `FunctionTool` (`BaseTool`).

**Parameters**

| Parameter | Role |
|-----------|------|
| `name` | Tool id exposed to the model; defaults to the function name |
| `description` | Overrides auto-parsed docstring summary |
| `args_schema` | Optional Pydantic `BaseModel`; if omitted, a model is built from type hints and docstring `Args` |
| `timeout` | Per-tool timeout (seconds), combined with executor defaults |
| `organization_id` | Optional tenant scope for policy / storage |

**Behavior**

- Docstrings are parsed (short + long description, per-parameter text).
- Parameters are mapped to a Pydantic model for JSON Schema export and runtime validation.

```python
from agenticx.tools.function_tool import tool

@tool(name="add", description="Add two integers.", timeout=5.0)
def add(a: int, b: int) -> int:
    """Add a and b.

    Args:
        a: First operand.
        b: Second operand.
    """
    return a + b
```

!!! tip "Explicit schemas"
    For stable public contracts, pass `args_schema=` with a dedicated Pydantic model instead of relying only on inferred types.

## Built-in Studio tools

Studio sessions use `STUDIO_TOOLS` in `agenticx.cli.agent_tools`: a list of OpenAI-style `function` definitions wired to async handlers. Core categories:

| Name | Purpose |
|------|---------|
| `bash_exec` | Run shell commands in the workspace (with guards and confirmations where applicable) |
| `file_read` | Read file content with optional line range |
| `file_write` | Full-file write after diff preview and user confirmation |
| `file_edit` | Targeted replace after diff preview and confirmation |
| `list_files` | List workspace files |
| `codegen` | Drive the code generation engine (agent / workflow / tool / skill targets) |
| `mcp_connect`, `mcp_call`, `mcp_import` | Connect to MCP servers, invoke tools, import external MCP JSON |
| `skill_use`, `skill_list` | Activate or enumerate skill bundles |
| `todo_write` | Structured task list for the session |
| `scratchpad_read`, `scratchpad_write` | Session scratchpad |
| `memory_append`, `memory_search` | Lightweight memory helpers |
| `lsp_goto_definition`, `lsp_find_references`, `lsp_hover`, `lsp_diagnostics` | LSP-backed navigation and diagnostics |

Meta-only tools (delegation, resource checks, etc.) are defined separately (`META_AGENT_TOOLS`); avatars typically receive the Studio subset above.

!!! warning "Destructive writes"
    `file_write` and `file_edit` are designed for confirmation flows. Automations should respect the same UX guarantees the Studio server enforces.

## MCP Hub

`MCPHub` (`agenticx.tools.mcp_hub`) aggregates multiple MCP servers:

- **`MCPClientV2`**: one client per `MCPServerConfig`, persistent session, `discover_tools()` / `call_tool()`.
- **`discover_all_tools()`**: merges tool lists and builds a **routing table** (handles name collisions with prefixed routed names).
- **`get_tools_for_agent()`**: when `auto_mode=True`, returns `MCPHubTool` instances (`BaseTool`) ready for injection.
- **`MCPHubConfig`**: Pydantic model with `servers: List[MCPServerConfig]` and `auto_mode`.

```python
from agenticx.tools.mcp_hub import MCPHub, MCPHubConfig
from agenticx.tools.remote_v2 import MCPServerConfig

config = MCPHubConfig(
    servers=[
        MCPServerConfig(name="docs", command="npx", args=["-y", "@some/mcp-server"]),
    ],
    auto_mode=True,
)
# hub = MCPHub.from_config(config)  # then await hub.discover_all_tools()
```

**Configuration files**

- `load_mcp_config()` in `agenticx.tools.remote` reads a JSON file (default `~/.cursor/mcp.json`) into `Dict[str, MCPServerConfig]`.
- You can maintain the same structure in a project-local file (for example `mcp_config.json`) and load it with an explicit path.

!!! note "Transport"
    The bundled MCP client path used by `MCPHub` / `MCPClientV2` is **stdio**-oriented (child process). HTTP or SSE MCP endpoints are usually fronted by a local command or proxy that speaks stdio to AgenticX.

## Remote tools

AgenticX does **not** ship a class named `RemoteToolProvider`. Remote capability is modeled as:

| Type | Use |
|------|-----|
| `RemoteTool` | One `BaseTool` wrapping a single MCP tool on a given `MCPServerConfig` |
| `MCPClient` | Legacy client helper to list tools and construct `RemoteTool` instances |
| `MCPClientV2` | Preferred session-based client; used internally by `MCPHub` |

`MCPServerConfig` fields include `command`, `args`, `env`, `timeout`, optional `cwd`, `enabled_tools`, and `assign_to_agents` for filtering.

!!! tip "Secrets"
    Put tokens in `env` on `MCPServerConfig`, or resolve them from `CredentialStore` before building the config (see below).

## OpenAPI toolset

`OpenAPIToolset` (`agenticx.tools.openapi_toolset`) builds `BaseTool` instances from **OpenAPI 3.x** or **Swagger 2.0**:

- `OpenAPIToolset.from_file(path)`
- `OpenAPIToolset.from_url(url)`

Operations become callable tools with generated parameter models and HTTP execution aligned to the spec.

!!! warning "Auth and side effects"
    Generated tools execute real HTTP requests. Restrict base URLs, pin specs, and supply credentials deliberately—treat them like production API clients.

## Skill bundle

Skills follow the Anthropic-style `SKILL.md` layout with YAML front matter. **`SkillBundleLoader`** (`agenticx.tools.skill_bundle`) scans standard locations (`.agents/skills`, `.agent/skills`, `~/.agents/skills`, `.claude/skills`, package builtins, etc.), applies optional **`SkillGate`** rules (`metadata.agenticx.gate`), and exposes skills as tools (e.g. **`SkillTool`**) for list/read and progressive disclosure.

**Session-level injection**

- In Studio, `skill_use` / `skill_list` tie into the loader so activated skills affect the current session context.
- `SkillBundleLoader` accepts `execution_backend` for sandboxed or alternate execution paths when running skill payloads.

!!! note "“SkillBundle” vs loader"
    The codebase centers on `SkillBundleLoader` and `SkillMetadata`; there is no separate `SkillBundle` class. Conceptually a “bundle” is the loaded set of skills from configured search paths.

## AGX Bundle

An AGX Bundle (`agenticx.extensions`) is a distributable package that combines skills, MCP server configs, avatar presets, and memory templates into a single directory identified by an `agx-bundle.yaml` manifest.

```
my-bundle/
├── agx-bundle.yaml
├── skills/my-skill/SKILL.md
├── mcp/web-crawler.json
├── avatars/researcher.yaml
└── memory/research-workflow.md
```

**Key components**

| Module | Role |
|--------|------|
| `agenticx.extensions.bundle` | Parses `agx-bundle.yaml` → `BundleManifest` with path safety validation |
| `agenticx.extensions.installer` | `install_bundle()`, `uninstall_bundle()`, `list_installed_bundles()` |
| `agenticx.extensions.registry_hub` | `RegistryHub` — aggregated search + install across multiple registry sources |

**Install example**

```python
from pathlib import Path
from agenticx.extensions.installer import install_bundle

result = install_bundle(Path("./my-bundle"))
print(result.skills_installed, result.mcp_servers_installed)
```

Installed skills land in `~/.agenticx/skills/bundles/<name>/` and are picked up automatically by `SkillBundleLoader`.

See the [Extensions & Skill Ecosystem guide](../guides/extensions.md) for the full workflow including Desktop GUI, marketplace search, and registry configuration.

## Tool executor

`ToolExecutor` (`agenticx.tools.executor`) is the shared execution pipeline for `BaseTool` instances.

**Typical flow (`execute` / `aexecute`)**

1. Optional **`policy_stack.check(tool.name)`** — declarative deny rules (OpenClaw-inspired).
2. Resolve **timeout** from the tool and `default_timeout`.
3. Optional **`SafetyLayer.validate_tool_input`** — block or flag arguments before run.
4. **`tool.run` / `tool.arun`** — internally validates kwargs against **`args_schema`** (Pydantic).
5. Optional **`SafetyLayer.sanitize_tool_output`** for string results.
6. Optional **`post_state_hook`** on the tool for state sidecars.
7. **`ToolCallingRecord`** appended (success or failure), with rolling retention.

**Retry and timeout**

| Constructor arg | Meaning |
|-----------------|--------|
| `max_retries` | Extra attempts after failure (default `3`) |
| `retry_delay` | Sleep between attempts (seconds) |
| `default_timeout` | Fallback if the tool has no `timeout` |

Retries skip obvious non-retriable cases (e.g. `ToolTimeoutError`).

**Related**

- `ApprovalRequiredError` bubbles out without being treated as a generic failure.
- `sandbox_config: SandboxConfig` enables advanced backends (`subprocess`, `microsandbox`, `docker`) for code execution helpers on the same class.

## Credential management

**`CredentialStore`** (`agenticx.tools.credentials`) stores encrypted key–value material under `~/.agenticx/credentials` by default (Fernet when `cryptography` is installed). Use it for API keys and tokens that tools or MCP `env` maps need at runtime.

**`SecurityManager`** (`agenticx.core.security`) also embeds a `CredentialStore` for higher-level permission and audit integration.

!!! warning "Filesystem permissions"
    Encryption keys live beside the store (`encryption.key`). Ensure user-only permissions on `~/.agenticx` on shared machines.

## Sandbox integration

**`SandboxConfig`** (`agenticx.tools.executor`) selects a backend for advanced runs:

| Backend | Isolation |
|---------|-----------|
| `subprocess` | Separate OS process |
| `microsandbox` | Sandboxed runtime (when available) |
| `docker` | Container isolation |
| `auto` | Resolver picks a implementation |

**`SandboxPolicy`** (`agenticx.safety.sandbox_policy`) recommends backends from **risk level** or **tool name heuristics**:

| Inferred / assigned risk | Suggested backend |
|--------------------------|-------------------|
| `LOW` | No forced backend (`None`) |
| `MEDIUM` | `subprocess` |
| `HIGH` / `CRITICAL` | `docker` |

Optional **`ToolRiskProfile`** entries override inference per `tool_name` (`force_backend`, `network_enabled`, `max_timeout`).

!!! tip "Align policy with executor"
    Use `SandboxPolicy.recommend()` to build or tune a `SandboxConfig` for `ToolExecutor`; keep high-risk tools on stronger isolation even if default Studio tools run in the workspace process.
