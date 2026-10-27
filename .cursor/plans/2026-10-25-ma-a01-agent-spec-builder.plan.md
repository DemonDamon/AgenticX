# MA-A01 Agent 定义装配（Manifest → headless AgentRuntime）

Planned-with: Claude Opus 5.5
Suggested-Impl-Model: Grok 4.7
Parent: .cursor/plans/2026-10-25-managed-agents-master.plan.md（W1）
Depends-on: MA-00（`agenticx/managed/{protocol,manifest,errors}.py` 已按 `.cursor/plans/2026-10-25-ma-00-protocol-freeze.plan.md` 落地）

> 波次：W1。可与 MA-A02 并行。MA-A03 / MA-A04 / MA-A05 依赖本子规划导出的名字，**名字与签名不得改**。

---

## 1. 目标

把一份已通过 `validate_manifest` 的 Agent Manifest（`agx.agent/v1`）编译成一个不可变的 `AgentSpec`，再由 `ManagedAgentBuilder` 装配出一个**不依赖 Studio** 的 `AgentRuntime` + `StudioSession` 组合（`ManagedRuntimeBundle`），供 MA-A04 托管宿主（云端执行）和 MA-A05 Worker（桌面执行）共用。

同时提供一个可注入的 LLM 工厂接口 `LLMFactory`：W1 用本机 `~/.agenticx/config.yaml` 的 provider 配置（`LocalConfigLLMFactory`），MA-E03 换成「经企业网关」的实现，不改本子规划代码。

## 2. 根因 / 动机与证据链

- 总规划第 4 节决策 1：托管运行时复用框架 `AgentRuntime`，不另写循环。第 9 节 MA-A01 行：「Manifest → 工具表、MCP 配置、系统提示、`AgentRuntime` 实例；不得 import `agenticx.studio`」。
- 现有代码里**已有一个 headless 先例**：`agenticx/cli/main.py:1009-1027`（`agx loop` 命令）直接 `StudioSession(provider_name=..., model_name=...)` + `ProviderResolver.resolve(provider_name=..., model=...)` + `AgentRuntime(llm, SyncConfirmGate())`，没有经过 Studio。本子规划沿用这个模式。
- `StudioSession` 定义在 `agenticx/cli/studio.py:53-95`（`@dataclass`），**不在** `agenticx.studio` 包里，可以 import。
- `AgentRuntime.__init__`：`agenticx/runtime/agent_runtime.py:3586-3602`，参数 `llm, confirm_gate, *, max_tool_rounds, loop_warning_threshold, loop_critical_threshold, hooks, team_manager, mid_turn_persist, clarify_gate, is_unattended, llm_factory, checkpoint_store, run_recorder`。
- `AgentRuntime.__init__` 会**无条件**向 `self.hooks` 注册 7 个个人模式 hook（`agent_runtime.py:3645-3685`：`LegacyEventBridgeHook`、`MemoryHook`、`SessionSummaryHook`、`ObservationHook`、`SessionReviewHook`、`SessionFreezeHook`、`TurnArchiveHook`）。这些 hook 会往宿主机 `~/.agenticx/workspace` 写长期记忆、技能复盘等个人数据。托管会话**不能**写这些数据 → builder 在构造后把 `runtime.hooks` 整体替换为一个新的 `HookRegistry()`，只注册调用方传入的 hook（MA-A03 的权限 hook）。替换属性不需要改 `agent_runtime.py`（`self.hooks` 在类中每次都经 `self.` 访问）。
- `run_turn` 签名：`agent_runtime.py:4076-4096`，关键参数 `user_input, session, should_stop, *, agent_id="meta", tools=None, system_prompt=None, usage_session_id=None`。`tools=None` 时会用 `studio_tools_for_session(session)`（`agent_runtime.py:4258-4260`，即全量 83 个 Studio 工具）——托管模式**必须**显式传 `tools`。
- `agent_id` 取 `"meta"`：`agent_runtime.py:8213-8230` 只有 `agent_id == "meta"` 时轮次耗尽产出 `ERROR{rounds_exhausted: True}`，否则产出 `SUBAGENT_PAUSED`；另外 `agent_id != "meta"` 每 8 轮会额外发 `SUBAGENT_CHECKPOINT`（`agent_runtime.py:4830`）。统一用 `"meta"` 让 MA-A02 的映射只处理一种形态。
- `run_turn` 中 `merge_ops_tools_into(full_tool_pool)`（`agent_runtime.py:4261-4266`）会在 `ops` 开关打开时往工具池追加运维工具。这些工具不在 Manifest 里——MA-A03 的权限引擎对「Manifest 未列出的工具」一律 deny，作为兜底；本子规划不处理。
- 自定义工具（`type: custom`）由调用方执行。`dispatch_tool_async` 对未知工具名的最后一道是 `session._fallback_chain`（`agenticx/cli/agent_tools.py:13297-13309`）：若 `session._fallback_chain` 是 `ToolFallbackChain`，调用 `await chain.execute(name, **arguments)` 并返回 `.output`。`ToolFallbackChain` / `ToolResolver` 定义在 `agenticx/tools/fallback_chain.py:30-128`。builder 通过这个现成扩展点把自定义工具接到 MA-A03 的 `CustomToolResolver`，**不改** `agent_tools.py`。
  - 由此产生的约束（builder 必须校验）：
    1. `ToolFallbackChain.execute(self, task_intent, *, max_level=None, **kwargs)`：自定义工具参数里若有 `task_intent` / `max_level` 键会与形参冲突抛 `TypeError`，被 `agent_tools.py:13305-13308` 吞掉后返回 `ERROR: unknown tool`。→ 自定义工具 `input_schema.properties` 不得含这两个键。
    2. `agent_tools.py:13250` 把 `lsp_` 前缀名派给 LSP；`agent_tools.py:13261` 把 `confirm_` 前缀名拦掉。→ 自定义工具名不得以 `lsp_` / `confirm_` 开头。
    3. 自定义工具名不得与任何内置工具名重名，否则会被内置实现截走。
- 工作目录：`agenticx/runtime/session_boundary.py:24-30` `ensure_session_workdir(session_id, *, root=None) -> Path | None` 创建 `<root>/<sid>/work`。文件类工具从 `session.taskspaces` / `session.workspace_dir` 推导可写根（`agenticx/cli/agent_tools.py:322-430` `_session_workspace_root_sets`）。builder 设置这两个字段即可把工具限制在会话私有目录。
- `ProviderResolver.resolve(provider_name=None, model=None)`：`agenticx/llms/provider_resolver.py:256-300`，按 `~/.agenticx/config.yaml` 的 provider 名解析。Manifest 的 `model` 字段格式 `"<providerId>/<modelName>"`（MA-00 `MODEL_RE`），按第一个 `/` 拆分即可。
- 内置工具全集：`agenticx/cli/agent_tools.py:802` `STUDIO_TOOLS`（OpenAI function tool dict 列表，共 83 个，2026-10-25 实测）。其中大量工具是个人桌面专属（`cc_bridge_*`、`wb_bridge_*`、`schedule_task`、`skill_manage`、`mcp_connect`、`memory_*`、`knowledge_*`、`request_clarification` 等），不能暴露给托管会话。本子规划定义白名单 `MANAGED_BUILTIN_TOOLS`。

## 3. In scope / Out of scope

**In scope（只能创建或修改这些文件）：**
- 新建 `agenticx/managed/spec.py`
- 新建 `agenticx/managed/llm.py`
- 新建 `agenticx/managed/builder.py`
- 新建 `agenticx/managed/testing.py`（测试与演示用的脚本化 LLM，放包内以便 MA-A03/A04/A05 与 `agx ma serve --fake-llm` 复用）
- 新建 `tests/managed/conftest.py`（见 §5.7；MA-A04 会在同一文件追加 live server fixture）
- 新建 `tests/managed/test_spec.py`
- 新建 `tests/managed/test_builder.py`
- 修改 `tests/managed/test_protocol.py` 中 **仅** `test_module_has_no_runtime_imports` 一个函数（见 §5.6）

**Out of scope：**
- 不改 `agenticx/managed/__init__.py`（MA-00 文件；保持轻量，不 re-export builder，避免 `import agenticx.managed` 拉起整个 runtime）。
- 不改 `agenticx/runtime/**`、`agenticx/cli/agent_tools.py`、`agenticx/cli/studio.py`、`agenticx/studio/**`。
- MCP 实际连接与 MCP 工具执行：W1 只把 MCP 配置编译进 `AgentSpec`（供 MA-A03 做策略判断），**不连接**。连接 + Vault 凭证注入在 MA-A06。原因：`StudioSession.mcp_hub` 是进程级单例 `GlobalMcpManager`（`agenticx/cli/studio.py:101-144`），多个托管会话会共用 hub，需要 MA-A06 一并设计隔离。
- Skills（`manifest.skills`）：W1 不加载，只保留在 spec 的 `metadata` 外不做处理（见 §4.1 `skills` 字段）。加载在后续子规划。
- 图片 / 文件内容块进模型：MA-A04 处理（W1 不支持）。
- 网关 LLM 工厂：MA-E03。

## 4. 精确落点：新建模块骨架

所有新文件头部遵循仓库 Python 规范：

```python
#!/usr/bin/env python3
"""<English one-line description>.

Author: Damon Li
"""
```

注释与 docstring 一律英文，禁止相对 import，import 全部放文件顶部。

### 4.1 `agenticx/managed/spec.py`

```python
from __future__ import annotations

import copy
from dataclasses import dataclass, field
from typing import Any, Literal, Mapping

from agenticx.cli.agent_tools import STUDIO_TOOLS
from agenticx.managed.errors import MANIFEST_INVALID, MAError
from agenticx.managed.manifest import validate_manifest

ToolKind = Literal["builtin", "mcp", "custom"]
ToolPolicy = Literal["always_allow", "always_ask"]   # same literal values as protocol.ToolPolicy

MANAGED_BUILTIN_TOOLS: tuple[str, ...] = (
    "bash_exec", "file_read", "file_write", "file_edit", "list_files", "code_outline",
    "web_fetch", "web_search", "get_current_datetime", "todo_write",
    "scratchpad_read", "scratchpad_write", "liteparse", "tool_result_recall",
)
RESERVED_CUSTOM_PREFIXES: tuple[str, ...] = ("lsp_", "confirm_")
RESERVED_CUSTOM_INPUT_PROPERTIES: tuple[str, ...] = ("task_intent", "max_level")

# Every function name exposed by STUDIO_TOOLS, plus runtime-internal names.
ALL_BUILTIN_NAMES: frozenset[str] = frozenset(
    {str(t["function"]["name"]) for t in STUDIO_TOOLS} | {"mcp_call", "tool_search"}
)


@dataclass(frozen=True)
class ToolEntry:
    name: str
    kind: ToolKind                 # "builtin" or "custom" in W1 (MCP tools are not enumerated)
    policy: ToolPolicy             # custom tools always carry "always_allow"
    schema: dict[str, Any]         # OpenAI function tool dict: {"type": "function", "function": {...}}


@dataclass(frozen=True)
class McpServerSpec:
    name: str
    url: str
    transport: Literal["http", "sse"]


@dataclass(frozen=True)
class McpToolsetSpec:
    server: str
    default_policy: ToolPolicy
    policies: Mapping[str, ToolPolicy]   # explicit per-tool policy (config.policy or inherited default)
    disabled: frozenset[str]             # configs with enabled == False

    def policy_for(self, tool_name: str) -> ToolPolicy | None:
        """Return None when the tool is disabled, else explicit policy or default_policy."""


@dataclass(frozen=True)
class AgentSpec:
    agent_id: str
    version: int
    manifest_hash: str
    model_ref: str                       # "<provider>/<model>" as written in the manifest
    provider: str
    model: str
    system: str
    tools: tuple[ToolEntry, ...]         # enabled tools only, order defined in §5.2
    mcp_servers: tuple[McpServerSpec, ...]
    mcp_toolsets: tuple[McpToolsetSpec, ...]
    skills: tuple[Mapping[str, Any], ...]  # normalized manifest.skills, carried but unused in W1
    max_tool_rounds: int
    max_session_tokens: int | None
    metadata: Mapping[str, Any]
    normalized_manifest: Mapping[str, Any] = field(repr=False)

    def tool(self, name: str) -> ToolEntry | None: ...
    def kind_of(self, name: str) -> ToolKind | None:
        """'builtin' / 'custom' for entries in self.tools; None otherwise (W1 never returns 'mcp')."""
    @property
    def custom_tool_names(self) -> frozenset[str]: ...
    @property
    def builtin_tool_names(self) -> frozenset[str]: ...
    def mcp_toolset(self, server: str) -> McpToolsetSpec | None: ...
    def tool_schemas(self) -> list[dict[str, Any]]:
        """Deep copies of ToolEntry.schema in self.tools order."""


def split_model_ref(model_ref: str) -> tuple[str, str]:
    """Split '<provider>/<model>' on the first '/'. Caller guarantees MODEL_RE already matched."""


def compile_spec(agent_id: str, version: int, manifest: Any) -> AgentSpec:
    """Validate + normalize + compile. Raises MAError(MANIFEST_INVALID) on any error."""
```

导出（模块末尾 `__all__`）：`ToolKind`、`ToolPolicy`、`MANAGED_BUILTIN_TOOLS`、`RESERVED_CUSTOM_PREFIXES`、`RESERVED_CUSTOM_INPUT_PROPERTIES`、`ALL_BUILTIN_NAMES`、`ToolEntry`、`McpServerSpec`、`McpToolsetSpec`、`AgentSpec`、`split_model_ref`、`compile_spec`。

### 4.2 `agenticx/managed/llm.py`

```python
from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Protocol, runtime_checkable

from agenticx.llms.provider_resolver import ProviderResolver


@dataclass(frozen=True)
class LLMCallContext:
    tenant_id: str
    session_id: str
    agent_id: str
    agent_version: int
    user_id: str | None = None


@runtime_checkable
class LLMFactory(Protocol):
    def create(self, *, provider: str, model: str, context: LLMCallContext) -> Any:
        """Return an LLM provider object accepted by AgentRuntime (has .invoke / .stream)."""


class LocalConfigLLMFactory:
    """W1 default: resolve from the local agx provider config (~/.agenticx/config.yaml)."""

    def create(self, *, provider: str, model: str, context: LLMCallContext) -> Any:
        del context
        return ProviderResolver.resolve(provider_name=provider, model=model)
```

MA-E03 会新增 `GatewayLLMFactory` 实现同一协议（携带 `X-AgenticX-Trace-Id` 与四主体头）。本子规划只定义协议与本地实现。

### 4.3 `agenticx/managed/builder.py`

```python
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any, AsyncGenerator, Awaitable, Callable, Sequence

from agenticx.cli.studio import StudioSession
from agenticx.managed.llm import LLMCallContext, LLMFactory
from agenticx.managed.spec import AgentSpec
from agenticx.runtime.agent_runtime import AgentRuntime
from agenticx.runtime.confirm import ConfirmGate, RiskAwareAutoConfirmGate
from agenticx.runtime.events import RuntimeEvent
from agenticx.runtime.hooks import AgentHook, HookRegistry
from agenticx.runtime.session_boundary import ensure_session_workdir
from agenticx.tools.fallback_chain import FallbackLevel, ToolFallbackChain, ToolResolver

MANAGED_AGENT_ID = "meta"
DEFAULT_SYSTEM_PROMPT = "You are a helpful assistant."
MANAGED_HOOK_PRIORITY = 100


@dataclass
class ManagedRuntimeBundle:
    runtime: AgentRuntime
    session: StudioSession
    tools: list[dict[str, Any]]
    system_prompt: str
    spec: AgentSpec
    workdir: Path
    context: LLMCallContext

    def run_turn(
        self,
        user_input: str,
        should_stop: Callable[[], bool | Awaitable[bool]] | None = None,
    ) -> AsyncGenerator[RuntimeEvent, None]:
        """Single place that fixes run_turn kwargs for managed sessions."""
        return self.runtime.run_turn(
            user_input,
            self.session,
            should_stop,
            agent_id=MANAGED_AGENT_ID,
            tools=self.tools,
            system_prompt=self.system_prompt,
            usage_session_id=self.context.session_id,
        )


def build_system_prompt(spec: AgentSpec, workdir: Path) -> str: ...


def rehydrate_agent_messages(wire_events: Sequence[dict[str, Any]]) -> list[dict[str, Any]]: ...


class ManagedAgentBuilder:
    def __init__(self, *, llm_factory: LLMFactory, workdir_root: Path) -> None: ...

    def build(
        self,
        spec: AgentSpec,
        *,
        context: LLMCallContext,
        confirm_gate: ConfirmGate | None = None,
        hooks: Sequence[AgentHook] = (),
        custom_tool_resolver: ToolResolver | None = None,
        history: Sequence[dict[str, Any]] = (),
    ) -> ManagedRuntimeBundle: ...
```

导出 `__all__`：`MANAGED_AGENT_ID`、`DEFAULT_SYSTEM_PROMPT`、`ManagedRuntimeBundle`、`ManagedAgentBuilder`、`build_system_prompt`、`rehydrate_agent_messages`。

### 4.4 `agenticx/managed/testing.py`

供测试与 `--fake-llm` 演示使用的脚本化 LLM，形态与 `tests/test_agent_runtime.py:15-41` 的 `_FakeResponse` / `_ToolThenFinalLLM` 一致（`invoke` 返回带 `.content` / `.tool_calls` 的对象；`stream` 不产出内容，这样 runtime 走 invoke 路径）。

```python
from __future__ import annotations

import threading
from dataclasses import dataclass, field
from typing import Any, Iterator, Sequence

from agenticx.managed.llm import LLMCallContext


@dataclass
class ScriptStep:
    content: str
    tool_calls: list[dict[str, Any]] = field(default_factory=list)


def tool_call(name: str, arguments: dict[str, Any], call_id: str) -> dict[str, Any]:
    """Return {"id": call_id, "type": "function", "function": {"name": name, "arguments": arguments}}."""


class _ScriptedResponse:
    def __init__(self, content: str, tool_calls: list[dict[str, Any]]) -> None:
        self.content = content
        self.tool_calls = tool_calls


class ScriptedLLM:
    """Thread-safe scripted LLM. After the script is exhausted it returns `fallback_text` with no tools."""

    def __init__(self, steps: Sequence[ScriptStep], *, fallback_text: str = "done") -> None: ...
    # attributes: calls: list[dict[str, Any]]  each item {"messages": [...copied dicts...], "tools": [names]}
    def invoke(self, messages: Any, **kwargs: Any) -> _ScriptedResponse: ...
    def stream(self, *args: Any, **kwargs: Any) -> Iterator[str]:
        return iter(())


class StaticLLMFactory:
    """LLMFactory that always returns the same object (one ScriptedLLM shared by all sessions)."""

    def __init__(self, llm: Any) -> None: ...
    def create(self, *, provider: str, model: str, context: LLMCallContext) -> Any:
        return self._llm


class PerSessionScriptFactory:
    """LLMFactory that builds a fresh ScriptedLLM(steps) per session_id and keeps it in `self.by_session`."""

    def __init__(self, steps: Sequence[ScriptStep], *, fallback_text: str = "done") -> None: ...
    def create(self, *, provider: str, model: str, context: LLMCallContext) -> ScriptedLLM: ...
```

`ScriptedLLM.invoke` 细节：在 `threading.Lock` 内取下一个 step；把 `messages` 每个元素 `dict(item)` 复制存入 `calls[-1]["messages"]`；`kwargs.get("tools")` 若为列表，取每个 `tool["function"]["name"]` 存入 `calls[-1]["tools"]`，否则存 `[]`；`tool_calls` 返回 step 的深拷贝。

## 5. 详细逻辑（Before / After 与算法）

### 5.1 `compile_spec(agent_id, version, manifest)`

1. `result = validate_manifest(manifest)`；`result.ok is False` → `raise MAError(MANIFEST_INVALID, "manifest invalid", details={"errors": result.errors})`。
2. `n = result.normalized`（已补默认值，见 MA-00 §3.3 规范化规则；因此 `n["tools"]`、`n["runtime"]`、各 toolset 的 `default_policy` / `configs`、每个 config 的 `enabled` / `policy` 都一定存在）。
3. 逐个 toolset 收集**语义错误**（字符串，最终 `sorted()`）：
   - `agx_builtin`（最多一个，MA-00 已保证）：对 `configs[j]`，`name not in MANAGED_BUILTIN_TOOLS` → `manifest.tools[<i>].configs[<j>].name: unknown builtin tool "<name>"`。
   - `custom`：
     - `name in ALL_BUILTIN_NAMES` → `manifest.tools[<i>].name: conflicts with builtin tool "<name>"`
     - `name` 以 `RESERVED_CUSTOM_PREFIXES` 任一开头 → `manifest.tools[<i>].name: reserved prefix "<prefix>"`
     - `input_schema.get("type", "object") != "object"` → `manifest.tools[<i>].input_schema: type must be "object"`
     - `input_schema.get("properties")` 是 dict 且含 `RESERVED_CUSTOM_INPUT_PROPERTIES` 中的键 `<p>`（逐个报）→ `manifest.tools[<i>].input_schema: property "<p>" is reserved`
   - `mcp`：无额外语义校验（server 引用已由 MA-00 校验）。
   - 有任何语义错误 → `raise MAError(MANIFEST_INVALID, "manifest invalid", details={"errors": sorted(errors)})`。
4. 构造 `tools`：
   - 若存在 `agx_builtin` toolset：按 `MANAGED_BUILTIN_TOOLS` 的顺序遍历每个内置名 `b`：找 `configs` 中 `name == b` 的 config；`enabled is False` → 跳过；policy = `config["policy"]` 若非 None 否则 toolset `default_policy`；无 config → `default_policy`。schema = 从 `STUDIO_TOOLS` 找 `function.name == b` 的那一项 `copy.deepcopy`。
   - 若不存在 `agx_builtin` toolset：没有任何内置工具。
   - 再按 manifest 顺序追加每个 `custom`：`ToolEntry(name, "custom", "always_allow", {"type": "function", "function": {"name": name, "description": description, "parameters": copy.deepcopy(input_schema)}})`。
5. `mcp_servers`：`McpServerSpec(name, url, transport)`（已归一）。`mcp_toolsets`：每个 `mcp` toolset → `McpToolsetSpec(server, default_policy, policies={c["name"]: (c["policy"] or default_policy) for c in configs if c["enabled"]}, disabled=frozenset(c["name"] for c in configs if c["enabled"] is False))`。`policy_for(t)`：`t in disabled` → None；`t in policies` → 该值；否则 `default_policy`。
6. `provider, model = split_model_ref(n["model"])`。
7. 返回 `AgentSpec(agent_id=agent_id, version=version, manifest_hash=result.manifest_hash, model_ref=n["model"], provider=provider, model=model, system=n["system"], tools=tuple(tools), mcp_servers=..., mcp_toolsets=..., skills=tuple(n["skills"]), max_tool_rounds=n["runtime"]["max_tool_rounds"], max_session_tokens=n["runtime"]["max_session_tokens"], metadata=dict(n["metadata"]), normalized_manifest=n)`。

`version` 必须是 `int >= 1`，否则 `raise ValueError("version must be >= 1")`（编程错误，不是 manifest 错误）。

### 5.2 工具顺序不变量

`spec.tools` 的顺序：先内置（`MANAGED_BUILTIN_TOOLS` 声明顺序，跳过禁用项），后自定义（manifest 顺序）。`tool_schemas()` 与之相同。测试会断言该顺序。

### 5.3 `build_system_prompt(spec, workdir)`

```text
{spec.system.strip() or DEFAULT_SYSTEM_PROMPT}

[managed-runtime]
Working directory: {workdir}
Only use the tools provided in this session.
```

即：`f"{base}\n\n[managed-runtime]\nWorking directory: {workdir}\nOnly use the tools provided in this session.\n"`。

### 5.4 `rehydrate_agent_messages(wire_events)`

输入是按 `seq` 升序的 MA wire 事件 dict 列表（MA-A02 `StoredEvent.to_wire()` 的输出）。输出给 `session.agent_messages` 的最小上下文：
- `type == "user.message"`：把 `content` 中 `type == "text"` 的块 `text` 用 `"\n"` 连接，非空则追加 `{"role": "user", "content": text}`。
- `type == "agent.message"`：同样连接 text 块，非空则追加 `{"role": "assistant", "content": text}`。
- 其他类型忽略（工具轮次不回填；这是 W1 已知限制，宿主重启后模型只看到问答文本）。

### 5.5 `ManagedAgentBuilder.build(...)`

伪代码（After）：

```python
def build(self, spec, *, context, confirm_gate=None, hooks=(), custom_tool_resolver=None, history=()):
    workdir = ensure_session_workdir(context.session_id, root=self._workdir_root)
    if workdir is None:
        raise ValueError("invalid session id for workdir")
    session = StudioSession(provider_name=spec.provider, model_name=spec.model)
    session.session_id = context.session_id
    session.workspace_dir = str(workdir)
    session.taskspaces = [{"id": "default", "label": "workspace", "path": str(workdir)}]
    session.kb_retrieval_mode = "auto"          # never "always": keeps eager knowledge_search off
    session.agent_messages = [dict(m) for m in history]
    if custom_tool_resolver is not None:
        chain = ToolFallbackChain()
        chain.register(FallbackLevel.API_CONNECTOR, custom_tool_resolver)
        session._fallback_chain = chain
    llm = self._llm_factory.create(provider=spec.provider, model=spec.model, context=context)
    gate = confirm_gate if confirm_gate is not None else RiskAwareAutoConfirmGate(unattended=True)
    runtime = AgentRuntime(
        llm,
        gate,
        max_tool_rounds=spec.max_tool_rounds,
        is_unattended=False,
        llm_factory=lambda: self._llm_factory.create(provider=spec.provider, model=spec.model, context=context),
    )
    runtime.hooks = HookRegistry()              # drop personal-mode hooks registered in __init__
    for hook in hooks:
        runtime.hooks.register(hook, priority=MANAGED_HOOK_PRIORITY)
    return ManagedRuntimeBundle(runtime=runtime, session=session, tools=spec.tool_schemas(),
                                system_prompt=build_system_prompt(spec, workdir), spec=spec,
                                workdir=workdir, context=context)
```

说明：
- `self._workdir_root` 必须是绝对路径；构造函数里 `Path(workdir_root).expanduser().resolve()`。
- `session.sticky_allowed_tools` 保持 dataclass 默认的空集合；builder **不得**往里放任何值（托管模式无 sticky allow，见 MA-A03）。
- 默认确认门 `RiskAwareAutoConfirmGate(unattended=True)`：受保护操作一律拒绝、低风险放行。MA-A04 / MA-A05 会传入 MA-A03 的 `ManagedConfirmGate` 覆盖它；这里的默认值只保证「没人传门时」是安全的。
- `kb_retrieval_mode="auto"`：`_kb_retrieval_always_mode`（`agent_runtime.py:3152-3173`）对 `"auto"` 直接返回 False，避免读宿主 KB 配置后对托管会话强制 `knowledge_search`；另外 `knowledge_search` 本就不在 `MANAGED_BUILTIN_TOOLS` 中，`agent_runtime.py:4348-4350` 与 `4884-4887` 的两条 KB 路径都以「工具在允许列表中」为前提，双保险。

### 5.6 修改 MA-00 测试（唯一允许改动的已有文件）

MA-00 的 `tests/managed/test_protocol.py::test_module_has_no_runtime_imports` 读取 `agenticx/managed/*.py` 全部源码并断言不含 `agenticx.studio` / `agenticx.runtime`。本子规划新增的 `builder.py` 必然 import `agenticx.runtime`，会让该测试失败。

- Before（意图）：glob `agenticx/managed/*.py`。
- After：只检查 MA-00 自己的四个文件，路径写死：

```python
MA00_MODULES = ("__init__.py", "protocol.py", "manifest.py", "errors.py")

def test_module_has_no_runtime_imports() -> None:
    root = Path(__file__).resolve().parents[2] / "agenticx" / "managed"
    for name in MA00_MODULES:
        text = (root / name).read_text(encoding="utf-8")
        assert "agenticx.studio" not in text, name
        assert "agenticx.runtime" not in text, name
```

只改这一个函数（以及在函数上方加 `MA00_MODULES` 常量；若文件已 `from pathlib import Path` 则复用，否则在文件顶部 import 区追加一行）。其他测试函数一字不动。

### 5.7 `tests/managed/conftest.py`（配置隔离）

仓库根 `tests/conftest.py` 已 autouse 把 `$HOME` 指到临时目录，`ConfigManager.GLOBAL_CONFIG_PATH` 通过元类按调用时 HOME 惰性解析（`agenticx/cli/config_manager.py:258-263`），所以全局配置已隔离。但 `ConfigManager.PROJECT_CONFIG_PATH = Path(".agenticx/config.yaml")`（`config_manager.py:269`）按**当前工作目录**解析，若开发者在仓库根放了项目配置会渗进测试。托管测试会大量经过读配置的 runtime 代码，统一隔离：

```python
#!/usr/bin/env python3
"""Shared fixtures for managed-agents tests.

Author: Damon Li
"""

from __future__ import annotations

from pathlib import Path
from typing import Iterator

import pytest

from agenticx.cli.config_manager import ConfigManager


@pytest.fixture(autouse=True)
def _isolate_project_config(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    monkeypatch.setattr(ConfigManager, "PROJECT_CONFIG_PATH", tmp_path / "project-config.yaml")
    ConfigManager._invalidate_yaml_cache(None)
    yield
    ConfigManager._invalidate_yaml_cache(None)
```

（与 `tests/test_enterprise_worker.py:31-34` 的隔离手法一致。）

## 6. FR / NFR / AC

| ID | 内容 | AC（测试文件 :: 函数 → 断言） |
|----|------|------|
| FR-1 | `compile_spec` 校验失败整体拒绝 | `tests/managed/test_spec.py::test_invalid_manifest_raises_with_errors`：输入 `{"schema": "agx.agent/v1"}` → `MAError`，`err.code == "manifest_invalid"`，`err.details["errors"] == ["manifest.model: is required"]` |
| FR-2 | 无 `agx_builtin` 时无内置工具 | `test_spec.py::test_minimal_manifest_has_no_tools`：`{"schema":"agx.agent/v1","model":"openai/gpt-4o"}` → `spec.tools == ()`、`spec.provider == "openai"`、`spec.model == "gpt-4o"`、`spec.max_tool_rounds == 40` |
| FR-3 | 内置工具白名单与默认策略 | `test_spec.py::test_builtin_toolset_default_allows_all_whitelisted`：`tools=[{"type":"agx_builtin"}]` → `[t.name for t in spec.tools] == list(MANAGED_BUILTIN_TOOLS)` 且全部 `policy == "always_allow"` 且 `kind == "builtin"` |
| FR-4 | config 覆盖策略、禁用移除 | `test_spec.py::test_builtin_config_overrides_and_disable`：`configs=[{"name":"bash_exec","policy":"always_ask"},{"name":"web_search","enabled":false}]`，`default_policy="always_allow"` → `spec.tool("bash_exec").policy == "always_ask"`；`spec.tool("web_search") is None`；`spec.kind_of("web_search") is None`；`spec.tool("file_read").policy == "always_allow"` |
| FR-5 | 未知内置名拒绝 | `test_spec.py::test_unknown_builtin_rejected`：configs 含 `{"name":"cc_bridge_start"}` → errors 恰为 `['manifest.tools[0].configs[0].name: unknown builtin tool "cc_bridge_start"']` |
| FR-6 | 自定义工具编译 | `test_spec.py::test_custom_tool_compiled`：custom `lookup_order`（input_schema `{"type":"object","properties":{"order_id":{"type":"string"}}}`）→ `spec.kind_of("lookup_order") == "custom"`；schema `["function"]["parameters"]["properties"]` 含 `order_id`；位于所有内置之后 |
| FR-7 | 自定义工具名冲突 / 保留前缀 / 保留参数 / 非 object | `test_spec.py::test_custom_tool_semantic_errors`：参数化四例：name `bash_exec` → `conflicts with builtin tool "bash_exec"`；name `lsp_x` → `reserved prefix "lsp_"`；properties 含 `task_intent` → `property "task_intent" is reserved`；input_schema `{"type":"array"}` → `type must be "object"`（均断言完整字符串，前缀 `manifest.tools[0].`） |
| FR-8 | MCP 配置编译但不出现在工具表 | `test_spec.py::test_mcp_toolset_compiled_not_enumerated`：manifest 带 server `github` 与 mcp toolset（default `always_ask`，config `get_issue: always_allow`，`delete_repo: enabled false`）→ `spec.tools == ()`；`spec.mcp_toolset("github").policy_for("get_issue") == "always_allow"`；`policy_for("list_prs") == "always_ask"`；`policy_for("delete_repo") is None`；`spec.mcp_servers[0].transport == "http"` |
| FR-9 | 白名单都真实存在 | `test_spec.py::test_whitelist_exists_in_studio_tools`：`set(MANAGED_BUILTIN_TOOLS) <= {t["function"]["name"] for t in STUDIO_TOOLS}` |
| FR-10 | spec 不可变、schema 深拷贝 | `test_spec.py::test_tool_schemas_are_copies`：修改 `spec.tool_schemas()[0]` 后再次调用结果不变；`dataclasses.FrozenInstanceError` on `spec.version = 2` |
| FR-11 | builder 装配会话与工作目录 | `tests/managed/test_builder.py::test_build_sets_workdir_and_session`：`workdir_root=tmp_path/"ma"`，`session_id="01JABCDEFGHJKMNPQRSTVWXYZ0"` → `bundle.workdir == (tmp_path/"ma"/sid/"work").resolve()` 且存在；`bundle.session.workspace_dir == str(bundle.workdir)`；`bundle.session.taskspaces[0]["id"] == "default"`；`bundle.session.provider_name == "fake"`；`bundle.runtime.max_tool_rounds == spec.max_tool_rounds` |
| FR-12 | 个人模式 hook 被替换 | `test_builder.py::test_personal_hooks_removed`：不传 hooks → `bundle.runtime.hooks.has_hooks() is False`；传入一个 `AgentHook()` 子类实例 → `len(bundle.runtime.hooks._entries) == 1` |
| FR-13 | 一轮对话可跑通 | `test_builder.py::test_run_turn_final_with_scripted_llm`：`ScriptedLLM([ScriptStep("hello from managed")])` + `StaticLLMFactory` → `async for` 收集 `bundle.run_turn("hi")`，存在 `type == "final"` 且 `data["text"] == "hello from managed"`；`llm.calls[0]["tools"]` 包含 `"bash_exec"`（manifest 带 agx_builtin）且不包含 `"cc_bridge_start"` |
| FR-14 | 自定义工具经 fallback chain 到 resolver | `test_builder.py::test_custom_tool_routes_to_resolver`：resolver 为测试内定义的 `ToolResolver` 子类（`can_handle` 返回 `name == "lookup_order"`，`resolve` 记录 kwargs 并返回 `"order shipped"`）；脚本第一步调用 `tool_call("lookup_order", {"order_id": "A-1"}, "call-1")`，第二步 final；断言出现 `tool_result` 事件 `data["result"] == "order shipped"` 且 resolver 收到 `{"order_id": "A-1"}` |
| FR-15 | 系统提示 | `test_builder.py::test_system_prompt_contains_workdir`：`build_system_prompt` 结果以 manifest system 开头，含 `"[managed-runtime]"` 与 `f"Working directory: {workdir}"`；system 为空时以 `DEFAULT_SYSTEM_PROMPT` 开头 |
| FR-16 | 历史回填 | `test_builder.py::test_rehydrate_agent_messages`：输入 `[user.message(text "q1"), agent.tool_use(...), agent.message(text "a1")]` → `[{"role":"user","content":"q1"},{"role":"assistant","content":"a1"}]` |
| FR-17 | LLM 工厂收到上下文 | `test_builder.py::test_llm_factory_receives_context`：自定义 factory 记录 `create` 的 kwargs → `provider == "fake"`、`model == "scripted"`、`context.session_id == sid` |
| NFR-1 | 不 import `agenticx.studio` | `test_builder.py::test_no_studio_imports_in_source`：读取 `agenticx/managed/spec.py`、`llm.py`、`builder.py`、`testing.py` 源码，均不含字符串 `agenticx.studio` |
| NFR-2 | import builder 不加载 Studio server | `test_builder.py::test_import_does_not_load_studio_server`：`subprocess.run([sys.executable, "-c", "import sys, agenticx.managed.builder; assert 'agenticx.studio.server' not in sys.modules"], check=True)` |
| NFR-3 | MA-00 测试仍绿 | `pytest tests/managed/test_protocol.py -q` 全绿（含修改后的 `test_module_has_no_runtime_imports`） |

测试中使用的 manifest 模型一律写 `"fake/scripted"`，LLM 用 `agenticx.managed.testing` 里的脚本 LLM，不触网。`tests/conftest.py` 已 autouse 把 `$HOME` 指到临时目录，测试不会污染真实 `~/.agenticx`。pytest 已配置 `asyncio_mode = "auto"`（`pyproject.toml:293-294`），异步测试直接写 `async def test_...`。

## 7. 验证命令

```bash
cd /Users/damon/myWork/AgenticX
pytest tests/managed -q --no-cov
python -c "import sys, agenticx.managed.builder; assert 'agenticx.studio.server' not in sys.modules; print('ok')"
git status --porcelain -- agenticx tests
```

`git status` 输出只能出现第 3 节列出的路径。

## 8. 回滚

全部为新增文件 + 一个测试函数改动。删除新增文件、`git checkout tests/managed/test_protocol.py` 即回滚。无运行时开关：本模块只被 MA-A03/A04/A05 显式 import，个人模式路径不引用它。

## 9. 不变量

- `agenticx/runtime/agent_runtime.py`、`agenticx/cli/agent_tools.py`、`agenticx/cli/studio.py`、`agenticx/studio/**` 零改动。
- `agenticx/managed/__init__.py`（MA-00）零改动。
- 托管会话的 `session.sticky_allowed_tools` 永远为空集合。
- 托管会话不注册任何个人模式 hook（记忆、技能复盘、会话摘要、观察学习、TurnArchive、LegacyEventBridge）。
- `AgentSpec` / `ToolEntry` / `McpToolsetSpec` 为 frozen dataclass。

## 10. 已知限制与风险（写给实施者与后续子规划）

1. **轮次自动放宽**：`agent_runtime.py:4751-4795` 在 `agent_id == "meta"` 且会话 todo 未完成时，会把 `max_tool_rounds` 一次性放宽（上限 120）。托管 Manifest 的 `max_tool_rounds` 因此不是硬上限。不改 runtime 无法关闭（latch 在 `run_turn` 序言 `agent_runtime.py:4232` 重置）。记为已知偏差，由后续子规划决定是否给 runtime 加开关。
2. **宿主 `~/.agenticx/config.yaml` 仍影响运行时细节**：超时、`runtime.parallel_tools`、`ops` 工具开关、`effect_guard` 等仍从宿主配置读取。EffectGuard 默认开启（`agenticx/runtime/effect_guard.py:72-80`），会按 `session.session_id` 在宿主 HOME 下建账本目录。MA-E03 部署时应使用独立 HOME。
3. **`dispatch_tool_async` 仍执行个人权限 deny 列表**（`tool_denied_by_session_permissions`，`agent_tools.py:12818-12820`）：宿主机个人配置 deny 了某工具时，托管调用会得到 `ERROR:`。只会更严格，不会放宽，可接受。
4. **tool_search 投影**：若宿主配置把 tool search 强制开启，`project_tools_for_round`（`agenticx/runtime/tool_search.py:477-488`）可能延迟加载部分工具，含自定义工具。W1 工具数 ≤ 14 + 自定义，默认 `auto` 模式下不触发；如发现问题记录到 MA-A04 风险。
