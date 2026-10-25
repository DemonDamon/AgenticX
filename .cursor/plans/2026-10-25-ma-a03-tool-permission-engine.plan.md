# MA-A03 工具权限引擎（Manifest 策略 × 企业策略 → requires_action）

Planned-with: Claude Opus 5.5
Suggested-Impl-Model: Grok 4.7
Parent: .cursor/plans/2026-10-25-managed-agents-master.plan.md（W1）
Depends-on: MA-00、MA-A01（`AgentSpec`、`ToolKind`、`ToolPolicy`、`ManagedAgentBuilder`、`agenticx.managed.testing`）、MA-A02（`RuntimeEventAdapter`、`ToolUseLedger`、`ActionKind`）

> 风险等级：高（总规划第 9 节）。合入前建议强推理档只读审查。

---

## 1. 目标

1. `PermissionEngine`：对每一次工具调用，合并 Manifest 工具策略与企业策略 `enterprise_agent_policy`，按 **deny > ask > allow** 得出决定。
2. `ManagedPermissionHook`：挂在 `AgentRuntime` 的 `before_tool_call` 上，在工具执行前：落库 `agent.tool_use`（带 `evaluated_policy`）→ 需要确认时让会话进入 `requires_action` 并等待 `user.tool_confirmation` → 放行或拦截。
3. `ManagedConfirmGate`：替换个人模式确认门。托管模式下不弹任何 `confirm_required`，不支持「本会话总是允许」（sticky allow）。
4. `ActionBroker` 协议 + `CustomToolResolver`：自定义工具（调用方执行）走同一套「挂起等待 resolution」机制。MA-A04（云端宿主）与 MA-A05（桌面 Worker）各自实现 `ActionBroker`。

## 2. 根因 / 动机与证据链

- 总规划 1.2：工具权限只有 `always_allow` / `always_ask`；`enabled: false` 移除；`requires_action` 期间只接受 resolution 或中断。1.4：「托管模式下不提供会话级 sticky allow（与企业策略 `disable_session_allow` 一致）」。11 节：优先级「企业策略 > Manifest > 个人设置」。
- 现有确认机制**是按风险触发、在工具内部触发**，不适合「按工具名一律询问」：
  - `agenticx/cli/agent_tools.py:4354-4522` `_confirm(...)`：只有具体工具实现（如 `_tool_bash_exec`）判断有风险时才调用；低风险直接放行（`:4433-4440` allow 规则、`:4449-4465` sticky allow），emit `confirm_required`（`:4480-4499`）后等待确认门。
  - `agenticx/runtime/confirm.py:380-479` `ParkedApprovalConfirmGate`：只拦 `is_protected_confirm` 的请求（`:414-416` 低风险直接 True），并注册进**进程级** `agenticx.runtime.parked_approvals` 表、靠 Studio `POST /api/confirm` 解决。Manifest 的 `always_ask` 要求即使低风险也询问，且 resolution 来自 MA 事件 `user.tool_confirmation` 而非 Studio 接口。**因此不复用该类**，只复用它的模式：「先登记 → 再发布 id → await future」。
  - 企业策略已在 `dispatch_tool_async` 入口执行：`agent_tools.py:12827-12857` 命中 deny 直接返回 `ERROR: 企业策略禁止...`；`:12908-12926` 命中 always_ask 调 `_confirm(..., context={"tool", "risk": "policy", "enterprise_policy": True})`。它通过 `load_enterprise_agent_policy()`（`agenticx/runtime/enterprise_agent_policy.py:81-94`）读**本机**配置——托管宿主上通常为空策略；桌面 Worker 上是员工登录的企业策略。
- 拦截点：`AgentHook.before_tool_call(tool_name, arguments, session) -> HookOutcome | None`（`agenticx/runtime/hooks/__init__.py:33-39`），`HookRegistry.run_before_tool_call` 遇到第一个 `blocked=True` 即返回（`:94-104`）。runtime 在执行每个工具前 await 它（`agenticx/runtime/agent_runtime.py:7394`），被拦截时依次 yield `TOOL_CALL`、`ERROR{text, tool_call_id}`、`TOOL_RESULT{is_error: True, result: reason}`，并把 reason 作为 tool 消息喂回模型（`:7395-7449`）。hook 是 `async`，可以在里面长时间 await（等人批准），runtime 不会对它计时。
- hook 拿不到 `tool_call_id`，且在 `TOOL_CALL` 之前运行 → `agent.tool_use` 必须由 hook 先行落库，MA-A02 的 `ToolUseLedger` 负责把随后的 `TOOL_CALL` 绑定回来（见 MA-A02 §2、§4.6）。
- 工具在一轮内串行执行（`agent_runtime.py:6997`），所以一次 `requires_action` 实际只含一个待决事件；状态机支持多个，留给未来并行。
- 企业策略 API（直接复用，不改）：`EnterpriseAgentPolicy(denied, always_ask, disable_session_allow)`（`enterprise_agent_policy.py:28-31`）、`policy_from_mapping(raw)`（`:62-78`）、`enterprise_denied_subject(tool_name, arguments, policy)`（`:128-136`）、`enterprise_ask_subject(...)`（`:139-147`）、主体规则 `policy_subjects`（`:97-113`：工具名；`mcp_call` 额外 `mcp:<tool_name>`；`bash_exec` 含 `git push` 额外 `git:push`）。
- 自定义工具执行入口：`session._fallback_chain`（`agent_tools.py:13297-13309`）+ `ToolResolver`（`agenticx/tools/fallback_chain.py:30-39`）。MA-A01 已把 resolver 挂上去，本子规划提供 resolver 实现。`ToolFallbackChain.execute` 会吞掉 resolver 异常并最终返回 `ERROR: unknown tool`（`fallback_chain.py:117-128`），所以 resolver **不得抛异常**。

## 3. In scope / Out of scope

**In scope（只能创建或修改这些文件）：**
- 新建 `agenticx/managed/permissions.py`
- 新建 `agenticx/managed/actions.py`
- 新建 `tests/managed/test_permissions.py`
- 新建 `tests/managed/test_actions.py`
- 新建 `tests/managed/test_permission_runtime_integration.py`

**Out of scope：**
- 不改 `agenticx/runtime/confirm.py`、`agenticx/runtime/parked_approvals.py`、`agenticx/runtime/enterprise_agent_policy.py`、`agenticx/cli/agent_tools.py`、`agenticx/runtime/agent_runtime.py`。
- MCP 工具的实际拦截接线（W1 不连接 MCP，见 MA-A01 §3）。`PermissionEngine.evaluate_mcp` 提供并测试，供 MA-A06 接线。
- `requires_action` 超时：W1 无限等待（与总规划 1.2 共识一致：无人值守场景不应依赖 `always_ask`）。宿主重启后的收尾由 MA-A02 `recover_after_restart` + MA-A04 启动扫描负责。
- 个人设置（`~/.agenticx/config.yaml` 的 `permissions.*`）不参与 `PermissionEngine` 决策。注意 `dispatch_tool_async` 内部的个人 deny 列表（`agent_tools.py:12818-12820`）仍会生效，只会更严格。

## 4. 模块设计

文件头、英文注释、绝对 import、import 置顶（同 MA-A01 §4）。

### 4.1 `agenticx/managed/actions.py`

```python
from __future__ import annotations

from typing import Any, Mapping, Protocol, Sequence, runtime_checkable

from agenticx.managed.events.state_machine import ActionKind
from agenticx.managed.protocol import ClientEvent, UserCustomToolResult
from agenticx.managed.spec import ToolKind, ToolPolicy
from agenticx.tools.fallback_chain import ToolResolver


@runtime_checkable
class ActionBroker(Protocol):
    """Bridge between in-runtime hooks and the session event log.

    Implemented by MA-A04 (SessionActor, cloud) and MA-A05 (RemoteActionBroker, desktop worker).
    """

    async def announce_tool_use(
        self,
        *,
        kind: ToolKind,
        name: str,
        input: Mapping[str, Any],
        evaluated_policy: ToolPolicy | None,
        mcp_server: str | None = None,
    ) -> str:
        """Persist an agent.tool_use / agent.mcp_tool_use / agent.custom_tool_use event; return its id."""

    async def request_action(self, event_id: str, kind: ActionKind) -> ClientEvent | None:
        """Move the session to requires_action for event_id and wait.

        Returns the resolving UserToolConfirmation / UserCustomToolResult,
        or None when the wait was voided by user.interrupt.
        """

    def custom_tool_use_id(self, name: str) -> str | None:
        """Event id of the in-flight agent.custom_tool_use for this tool name (ledger lookup)."""


def render_content_text(blocks: Sequence[Any]) -> str: ...


class CustomToolResolver(ToolResolver):
    def __init__(self, *, broker: ActionBroker, custom_tool_names: frozenset[str]) -> None: ...
    async def can_handle(self, task_intent: str) -> bool: ...
    async def resolve(self, task_intent: str, **kwargs: Any) -> str: ...
```

`render_content_text(blocks)`：输入是 MA-00 的内容块（pydantic 模型）或等价 dict；
- `text` 块 → 其 `text`；
- `document` 块：source 为 `text` → `f"[document: {title}]\n{source.text}"`（title 为 None 时写 `[document]`）；source 为 `file` → `f"[document file: {file_id}]"`；
- `image` 块 → `"[image omitted]"`；
- 以 `"\n"` 连接，`strip()` 后返回。

`CustomToolResolver.can_handle(task_intent)`：`task_intent in self._names`。

`CustomToolResolver.resolve(task_intent, **kwargs)`（**整体包在 `try/except Exception` 里，异常返回 `f"ERROR: custom tool bridge failed: {type(exc).__name__}"`**）：

```python
event_id = self._broker.custom_tool_use_id(task_intent)
if event_id is None:
    return "ERROR: custom tool use was not announced"
resolution = await self._broker.request_action(event_id, "custom_tool_result")
if resolution is None:
    return "CANCELLED: interrupted while waiting for custom tool result"
assert isinstance(resolution, UserCustomToolResult)   # replace with an if-check returning ERROR text
text = render_content_text(resolution.content)
if resolution.is_error:
    return f"ERROR: {text or 'custom tool failed'}"
return text or "(empty result)"
```

`kwargs`（模型给的参数）不需要在这里使用：参数已经由 MA-A02 适配器在 `agent.custom_tool_use.input` 里发给调用方。

### 4.2 `agenticx/managed/permissions.py`

```python
from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Literal, Mapping

from agenticx.managed.actions import ActionBroker
from agenticx.managed.ids import new_ulid
from agenticx.managed.protocol import UserToolConfirmation
from agenticx.managed.spec import AgentSpec, ToolPolicy
from agenticx.runtime.confirm import ConfirmGate
from agenticx.runtime.enterprise_agent_policy import (
    EnterpriseAgentPolicy,
    enterprise_ask_subject,
    enterprise_denied_subject,
)
from agenticx.runtime.hooks import AgentHook, HookOutcome

Decision = Literal["allow", "ask", "deny"]
DecisionSource = Literal["custom", "manifest", "enterprise", "unlisted"]


@dataclass(frozen=True)
class PermissionDecision:
    decision: Decision
    evaluated_policy: ToolPolicy      # "always_allow" for allow, "always_ask" for ask and deny
    source: DecisionSource
    subject: str | None               # matched enterprise subject, or the tool name
    reason: str


class PermissionEngine:
    def __init__(self, spec: AgentSpec, enterprise_policy: EnterpriseAgentPolicy | None = None) -> None: ...
    @property
    def spec(self) -> AgentSpec: ...
    @property
    def enterprise_policy(self) -> EnterpriseAgentPolicy: ...
    def evaluate(self, tool_name: str, arguments: Mapping[str, Any] | None) -> PermissionDecision: ...
    def evaluate_mcp(self, server: str, tool_name: str, arguments: Mapping[str, Any] | None) -> PermissionDecision: ...


class ToolAuthorization:
    """Single-slot grant shared by ManagedPermissionHook and ManagedConfirmGate."""

    def __init__(self) -> None:
        self.current: str | None = None
    def grant(self, tool_name: str) -> None: ...
    def revoke(self) -> None: ...
    def allows(self, tool_name: str | None) -> bool:
        """True iff a grant exists and (tool_name is None/empty or equals the granted name)."""


class ManagedConfirmGate(ConfirmGate):
    def __init__(self, authorization: ToolAuthorization) -> None: ...
    async def request_confirm(self, question: str, context: dict[str, Any] | None = None) -> bool: ...
    def should_emit_prompt(self, context: dict[str, Any] | None = None) -> bool:
        return False
    def is_service_mode(self) -> bool:
        return True
    def resolve(self, request_id: str, approved: bool) -> bool:
        return False


class ManagedPermissionHook(AgentHook):
    def __init__(self, *, engine: PermissionEngine, broker: ActionBroker,
                 authorization: ToolAuthorization) -> None: ...
    async def before_tool_call(self, tool_name: str, arguments: dict[str, Any], session: Any) -> HookOutcome | None: ...
```

`__all__` 列出以上全部公开名。

### 4.3 `PermissionEngine.evaluate` 算法（按顺序，先命中先返回）

```text
args = dict(arguments) if isinstance(arguments, Mapping) else {}
1. name in spec.custom_tool_names
       -> allow, evaluated_policy="always_allow", source="custom", subject=name, reason="custom tool executed by caller"
2. subj = enterprise_denied_subject(name, args, policy)
   subj -> deny, "always_ask", source="enterprise", subject=subj,
           reason=f'denied by enterprise policy "{subj}"'
3. entry = spec.tool(name)
   entry is None -> deny, "always_ask", source="unlisted", subject=name,
           reason=f'tool "{name}" is not enabled for this agent'
4. subj = enterprise_ask_subject(name, args, policy)
   subj -> ask, "always_ask", source="enterprise", subject=subj,
           reason=f'enterprise policy requires confirmation for "{subj}"'
5. entry.policy == "always_ask"
       -> ask, "always_ask", source="manifest", subject=name, reason="manifest policy always_ask"
6. otherwise -> allow, "always_allow", source="manifest", subject=name, reason="manifest policy always_allow"
```

说明：
- 自定义工具第 1 步就放行：它由调用方执行，企业「本机动作」策略不适用；放行后真正的等待发生在 `CustomToolResolver` 里。
- 第 3 步兜住所有 Manifest 之外的工具（例如宿主配置打开 `ops` 后 `merge_ops_tools_into` 混进来的工具，`agent_runtime.py:4261-4266`）。
- `enabled: false` 的内置工具不在 `spec.tools` 里（MA-A01），因此同样走第 3 步。

`evaluate_mcp(server, tool_name, arguments)`：

```text
subjects use the mcp_call form: probe_args = {"tool_name": tool_name}
1. subj = enterprise_denied_subject("mcp_call", probe_args, policy) -> deny (enterprise)
2. ts = spec.mcp_toolset(server); ts is None -> deny (unlisted), reason=f'mcp server "{server}" is not enabled for this agent'
3. pol = ts.policy_for(tool_name); pol is None -> deny (unlisted), reason=f'mcp tool "{server}/{tool_name}" is disabled for this agent'
4. subj = enterprise_ask_subject("mcp_call", probe_args, policy) -> ask (enterprise)
5. pol == "always_ask" -> ask (manifest); else allow (manifest)
```

`enterprise_policy` 为 None 时使用空的 `EnterpriseAgentPolicy()`——**引擎自己不读本机配置**。调用方决定来源：MA-A04 宿主从宿主配置文件读（`policy_from_mapping`），MA-A05 Worker 用 `load_enterprise_agent_policy()`。

### 4.4 `ManagedPermissionHook.before_tool_call` 算法

```python
async def before_tool_call(self, tool_name, arguments, session):
    self._authorization.revoke()
    decision = self._engine.evaluate(tool_name, arguments)
    if decision.source == "custom":
        return None                                   # CustomToolResolver handles the wait
    event_id = await self._broker.announce_tool_use(
        kind="builtin",                               # W1: MCP names never reach the runtime tool list
        name=tool_name,
        input=arguments if isinstance(arguments, dict) else {},
        evaluated_policy=decision.evaluated_policy,
    )
    if decision.decision == "deny":
        return HookOutcome(blocked=True, reason=f"ERROR: {decision.reason}")
    if decision.decision == "ask":
        resolution = await self._broker.request_action(event_id, "tool_confirmation")
        if resolution is None:
            return HookOutcome(blocked=True, reason="CANCELLED: interrupted while waiting for confirmation")
        if not isinstance(resolution, UserToolConfirmation) or resolution.result != "allow":
            note = getattr(resolution, "deny_message", None)
            reason = "CANCELLED: tool use denied by user"
            return HookOutcome(blocked=True, reason=f"{reason}: {note}" if note else reason)
    self._authorization.grant(tool_name)
    return None
```

拦截时 runtime 会把 `reason` 作为工具结果喂回模型并 yield `TOOL_RESULT{is_error: True}`（`agent_runtime.py:7395-7449`），MA-A02 适配器据此产出 `agent.tool_result{is_error: true}`。

**无 sticky allow 的保证：**引擎无状态、每次调用重新评估；`ToolAuthorization` 是单槽，每次 hook 进入先 `revoke()`；hook 从不写 `session.sticky_allowed_tools`。

### 4.5 `ManagedConfirmGate.request_confirm`

```python
payload = dict(context or {})
tool = str(payload.get("tool") or "").strip() or None
approved = self._authorization.allows(tool)
self.last_request = {
    "id": str(payload.get("request_id") or new_ulid()),
    "question": question,
    "context": payload,
    "decision": "managed_authorized" if approved else "managed_unauthorized",
}
return approved
```

语义：`dispatch_tool_async` 内部任何确认（风险确认、企业 ask 确认）都只在「权限引擎已经放行当前这个工具」时自动通过，否则拒绝；`should_emit_prompt` 恒为 False → 永不产生 `confirm_required` 事件（`agent_tools.py:4480` 以此为发事件条件）。

**风险（必须在 PR 描述写明）：** Manifest 把高风险内置工具（如 `bash_exec`）设为 `always_allow` 时，个人模式的「危险命令二次确认」在托管模式下不会出现——Manifest 是权威。演示与默认模板应把 `bash_exec` 设为 `always_ask`。

## 5. FR / NFR / AC

测试统一：`tests/managed/`，`asyncio_mode=auto`；manifest 模型写 `"fake/scripted"`；LLM 用 `agenticx.managed.testing.ScriptedLLM` + `StaticLLMFactory`。集成测试里用一个**测试文件内定义**的 `FakeBroker`：

```python
class FakeBroker:
    """In-memory ActionBroker for tests; feeds RuntimeEventAdapter like the real host does."""
    def __init__(self, adapter, resolutions):          # resolutions: list of ClientEvent | None, popped per request
        self.adapter = adapter; self.events = []; self.requests = []; self._resolutions = list(resolutions)
    async def announce_tool_use(self, *, kind, name, input, evaluated_policy, mcp_server=None):
        evs = self.adapter.build_tool_use(kind=kind, name=name, input=input,
                                          evaluated_policy=evaluated_policy, mcp_server=mcp_server)
        self.events.extend(evs); return evs[-1]["id"]
    async def request_action(self, event_id, kind):
        self.requests.append((event_id, kind)); return self._resolutions.pop(0)
    def custom_tool_use_id(self, name):
        return self.adapter.ledger.inflight_custom(name)
```

驱动方式：`async for ev in bundle.run_turn("go"): broker.events.extend(adapter.convert(ev).events)`，其中 `bundle = ManagedAgentBuilder(llm_factory=StaticLLMFactory(llm), workdir_root=tmp_path).build(spec, context=..., confirm_gate=ManagedConfirmGate(auth), hooks=[ManagedPermissionHook(engine=engine, broker=broker, authorization=auth)], custom_tool_resolver=CustomToolResolver(broker=broker, custom_tool_names=spec.custom_tool_names))`，`adapter = RuntimeEventAdapter(model_ref=spec.model_ref, kind_of=spec.kind_of)`，`adapter.begin_turn(Usage())`。需要避免真实执行工具的用例用 `monkeypatch.setattr(agenticx.runtime.agent_runtime, "dispatch_tool_async", fake)`（与 `tests/test_agent_runtime.py:197-203` 相同手法）；fake 记录调用并返回 `"tool-ok"`。

| ID | 内容 | AC（文件 :: 函数 → 断言） |
|----|------|------|
| FR-1 | 决策矩阵 | `test_permissions.py::test_evaluate_matrix`：spec 含 `bash_exec: always_ask`、`file_read: always_allow`、custom `lookup_order`；参数化断言 `(decision, source, evaluated_policy)`：`bash_exec` → (ask, manifest, always_ask)；`file_read` → (allow, manifest, always_allow)；`lookup_order` → (allow, custom, always_allow)；`cc_bridge_start` → (deny, unlisted, always_ask)；`web_search`（manifest 设 `enabled:false`）→ (deny, unlisted, always_ask) |
| FR-2 | 企业 deny 优先 | `test_permissions.py::test_enterprise_deny_beats_manifest_allow`：`EnterpriseAgentPolicy(denied=("file_*",))` → `file_read` 为 (deny, enterprise)，`subject == "file_read"`，reason 含 `denied by enterprise policy` |
| FR-3 | 企业 ask 升级 allow | `test_permissions.py::test_enterprise_ask_escalates_allow`：`always_ask=("git:push",)`；`bash_exec` 设为 always_allow；args `{"command": "git push origin main"}` → (ask, enterprise, subject `git:push`)；args `{"command":"ls"}` → (allow, manifest) |
| FR-4 | 企业策略不影响自定义工具 | `test_permissions.py::test_custom_tool_ignores_enterprise_deny`：`denied=("*",)` → `lookup_order` 仍 (allow, custom)；`file_read` 为 deny |
| FR-5 | MCP 评估 | `test_permissions.py::test_evaluate_mcp`：manifest server `github` toolset default always_ask，`get_issue: always_allow`，`delete_repo: enabled false` → `get_issue` allow；`list_prs` ask(manifest)；`delete_repo` deny(unlisted)；server `gitlab` deny(unlisted)；企业 `denied=("mcp:get_issue",)` → `get_issue` deny(enterprise) |
| FR-6 | 授权单槽 | `test_permissions.py::test_tool_authorization`：初始 `allows("x") is False`；`grant("bash_exec")` 后 `allows("bash_exec")`、`allows(None)` 为 True，`allows("file_write")` False；`revoke()` 后全 False |
| FR-7 | 确认门 | `test_permissions.py::test_managed_confirm_gate`：未授权 → `await gate.request_confirm("q", {"tool":"bash_exec"}) is False`，`last_request["decision"] == "managed_unauthorized"`；授权 `bash_exec` 后 → True；`should_emit_prompt({"risk":"high"}) is False` |
| FR-8 | 确认门接入现有 `_confirm` | `test_permissions.py::test_confirm_helper_uses_managed_gate`：`from agenticx.cli.agent_tools import _confirm`；授权 `bash_exec` 后 `await _confirm("rm?", confirm_gate=gate, context={"tool":"bash_exec","risk":"high"}, emit_event=recorder, session=None)` → True 且 `recorder` 未收到任何事件；未授权时 → False |
| FR-9 | hook：always_ask 批准 | `test_permission_runtime_integration.py::test_always_ask_allow_executes_tool`：脚本 `[tool_call("bash_exec", {"command":"echo hi"}, "c1"), ScriptStep("done")]`；`FakeBroker` resolutions `[UserToolConfirmation(type="user.tool_confirmation", tool_use_id=<ignored>, result="allow")]`（tool_use_id 用任意非空串，FakeBroker 不校验）；断言：`broker.requests == [(id_of_first_agent_tool_use, "tool_confirmation")]`；`broker.events` 中第一个 `agent.tool_use` 的 `evaluated_policy == "always_ask"`；fake dispatch 被调用 1 次；存在 `agent.tool_result` 且 `tool_use_id` 等于该 tool_use id、`is_error is False`；`agent.tool_use` 仅 1 条（无重复） |
| FR-10 | hook：用户拒绝 | `test_permission_runtime_integration.py::test_always_ask_deny_blocks_tool`：resolution `result="deny", deny_message="nope"` → fake dispatch 调用 0 次；`agent.tool_result.is_error is True`，其 text 以 `"CANCELLED: tool use denied by user: nope"` 开头；`llm.calls[1]["messages"]` 中存在 role `tool` 且 content 含该文本 |
| FR-11 | hook：中断 | `test_permission_runtime_integration.py::test_interrupt_while_waiting_returns_cancelled`：resolution `None` → `agent.tool_result` text 以 `"CANCELLED: interrupted while waiting for confirmation"` 开头，dispatch 0 次 |
| FR-12 | 无 sticky allow | `test_permission_runtime_integration.py::test_no_sticky_allow_each_call_asks`：脚本两次 `bash_exec`（c1、c2）后 final；两次 allow → `len(broker.requests) == 2`；`bundle.session.sticky_allowed_tools == set()` |
| FR-13 | 企业 deny 不等待 | `test_permission_runtime_integration.py::test_enterprise_deny_blocks_without_request`：engine 带 `denied=("bash_exec",)` → `broker.requests == []`；`agent.tool_result.is_error is True`，text 以 `'ERROR: denied by enterprise policy "bash_exec"'` 开头 |
| FR-14 | always_allow 直接执行 | `test_permission_runtime_integration.py::test_always_allow_executes_without_request`：`file_read` always_allow → requests 为空，`agent.tool_use.evaluated_policy == "always_allow"`，dispatch 1 次 |
| FR-15 | 自定义工具往返 | `test_permission_runtime_integration.py::test_custom_tool_roundtrip`：**不** monkeypatch dispatch（走真实 fallback chain）；脚本 `[tool_call("lookup_order", {"order_id":"A-1"}, "c1"), ScriptStep("final")]`；resolutions `[UserCustomToolResult(type="user.custom_tool_result", custom_tool_use_id="x", content=[TextBlock(type="text", text="shipped")])]` → `broker.requests == [(custom_event_id, "custom_tool_result")]`，`custom_event_id` 等于 `broker.events` 中 `agent.custom_tool_use` 的 id（该事件由适配器在 TOOL_CALL 时产出）；`llm.calls[1]["messages"]` 中 tool 消息 content == `"shipped"`；`broker.events` 中**没有** `agent.tool_result` |
| FR-16 | resolver 错误分支 | `test_actions.py::test_custom_resolver_branches`：①`custom_tool_use_id` 返回 None → `"ERROR: custom tool use was not announced"`；②resolution None → `"CANCELLED: interrupted while waiting for custom tool result"`；③`is_error=True` + text "bad" → `"ERROR: bad"`；④content 为空 → `"(empty result)"`；⑤broker 抛异常 → 以 `"ERROR: custom tool bridge failed"` 开头，不抛出 |
| FR-17 | 内容渲染 | `test_actions.py::test_render_content_text`：text + document(text source, title "spec") + image → `"a\n[document: spec]\nbody\n[image omitted]"` |
| FR-18 | 协议一致 | `test_actions.py::test_broker_protocol_runtime_checkable`：`isinstance(FakeBroker(...), ActionBroker) is True` |
| NFR-1 | 不改既有文件 | `git status --porcelain -- agenticx tests` 只出现第 3 节文件 |
| NFR-2 | 不 import Studio | `test_actions.py::test_no_studio_imports`：`permissions.py` / `actions.py` 源码不含 `agenticx.studio` |
| NFR-3 | 既有确认门与企业策略测试不回归 | `pytest tests/test_parked_approval_gate.py tests/test_enterprise_agent_policy.py tests/test_enterprise_agent_policy_dispatch.py -q --no-cov` 全绿 |

## 6. 验证命令

```bash
cd /Users/damon/myWork/AgenticX
pytest tests/managed/test_permissions.py tests/managed/test_actions.py tests/managed/test_permission_runtime_integration.py -q --no-cov
pytest tests/test_parked_approval_gate.py tests/test_enterprise_agent_policy.py tests/test_enterprise_agent_policy_dispatch.py -q --no-cov
git status --porcelain -- agenticx tests
```

## 7. 回滚

全部新增文件，删除即回滚；只被 MA-A04 / MA-A05 显式引用，个人模式不受影响。

## 8. 不变量

- 个人模式确认流程（`AsyncConfirmGate`、`ParkedApprovalConfirmGate`、`RiskAwareAutoConfirmGate`、Studio `POST /api/confirm`、`parked_approvals` 表）零改动、零调用。
- 托管会话永不产生 `confirm_required` / `confirm_response` 运行时事件。
- 托管会话永不写 `session.sticky_allowed_tools`。
- 决策优先级恒为 deny > ask > allow；企业策略的 deny / ask 不会被 Manifest 的 allow 覆盖。
- `CustomToolResolver.resolve` 永不抛异常。

## 9. 与总规划的偏差（需用户确认）

总规划第 9 节 MA-A03 行写「对接 `ParkedApprovalConfirmGate` 产出 `requires_action`」。本子规划**改为 hook + `ActionBroker`**，原因见 §2：该确认门只对受保护风险触发、低风险自动放行，且绑定 Studio 的进程级挂起表与 `/api/confirm`，无法表达「按工具名一律询问」和「resolution 来自 MA 事件」。行为结果与总规划意图一致（`always_ask` → `requires_action` → resolution），只是落点不同。如用户同意，应在总规划第 12 节变更记录补一行。
