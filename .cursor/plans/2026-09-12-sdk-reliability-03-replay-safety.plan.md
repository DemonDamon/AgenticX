---
name: sdk-reliability-03-replay-safety
overview: 把"崩溃恢复后这个工具能不能重跑"从隐式判断变成显式的分层否决决策，并让每条否决都带可读理由。关键前提：仓库里已经存在副作用分级 agenticx/runtime/replay_ledger/effects.py::classify_tool_effect（EFFECT_CLASSES = none/read/local_write/external_write/unknown，未知一律 unknown 即 fail-closed），本 Subplan 复用它而不是另造一套分类法；但 agenticx/runtime/replay_ledger/__init__.py 目前 import store.py，而 store.py:42 import agenticx.studio.storage.factory，导致从 SDK 层引用 effects 会拉进 5 个 Studio 模块，破坏零耦合契约——必须先把该 __init__ 改成惰性导出（沿用 agenticx/runtime/__init__.py 已有的 __getattr__ 模式）。在此基础上新建 agenticx/reliability/replay_policy.py 实现分层否决，并给 BaseTool 加一个可选的 effect_class 声明位。
todos:
  - id: t1
    content: 惰性化 replay_ledger/__init__.py，使 effects 可被 SDK 层无 Studio 耦合引用
    status: pending
  - id: t2
    content: BaseTool 新增可选 effect_class 声明 + resolve_effect_class() 解析顺序
    status: pending
  - id: t3
    content: 新建 agenticx/reliability/replay_policy.py（分层否决 + 可读理由）
    status: pending
  - id: t4
    content: approve_unsafe_replay 逃生口（对已产出输出的调用无效）
    status: pending
  - id: t5
    content: ReActAgent.aresume() 改为经 replay_policy 决策
    status: pending
  - id: t6
    content: tests/test_reliability_replay_policy.py 全绿 + 零耦合校验
    status: pending
isProject: false
---

# Subplan 03：Replay 安全策略（分层否决）

**Plan-Id**: `2026-09-12-sdk-reliability-03-replay-safety`
**Plan-File**: `.cursor/plans/2026-09-12-sdk-reliability-03-replay-safety.plan.md`
**Master**: `2026-09-12-sdk-reliability-kernel-master`
**依赖**: Subplan 01（`CallLedger` / `Verdict`）、Subplan 02（`RunState.pending_calls` / `aresume`）
**Planned-with**: Claude Opus 5
**Suggested-Impl-Model**: Grok 4.6
**Made-with**: Damon Li

> **与 master plan 的偏差声明**：master §2 原写「`BaseTool.replay_safety`，取值 `idempotent|side_effecting|unknown`」。规划阶段核查代码后发现仓库已有 `EFFECT_CLASSES`（5 值）与 `classify_tool_effect()`，另造三值分类法会产生两套不可互转的语义。本 Subplan 改为**复用既有 5 值分类法**，属性名相应改为 `effect_class`。实施时同步修正 master plan §2 表格中的这一格。

---

## 1. 现状与根因

### 1.1 副作用分级已经存在（不要重造）

`agenticx/runtime/replay_ledger/contracts.py:17`：

```python
EFFECT_CLASSES = frozenset({"none", "read", "local_write", "external_write", "unknown"})
```

`agenticx/runtime/replay_ledger/effects.py:65-109` 的 `classify_tool_effect(tool_name, arguments)` 已经做到：

- 内置只读工具白名单（`file_read`/`web_search`/`knowledge_search`/…）→ `"read"`
- 本地写白名单（`file_write`/`file_edit`/`todo_write`/…）→ `"local_write"`
- 外部写白名单（IM 发消息 / 邮件 / 日历 / 审批 / `git_push` / GitHub 写操作）→ `"external_write"`
- `bash_exec` / `bash_bg_start` 走 `assess_command()` 深度判定：`/dev/tcp` 重定向、`external_publish`/`host_full_access`/`system_disruption`、`git push|fetch|pull` → `"external_write"`；动态重定向 → `"unknown"`；本地重定向/`touch|mkdir|mv|cp|tee`/`sed -i` → `"local_write"`
- `mcp_call`、`computer_*`、`browser_click`/`browser_type` → `"unknown"`
- **兜底 `return "unknown"`**（第 109 行）——已经是 fail-closed 姿态

函数注释写得很清楚：`"""Classify a tool without claiming safety for unknown integrations."""`

**结论：分类能力齐了，缺的是「拿分类做重放决策」的那一层。** 本 Subplan 只补决策层。

### 1.2 但从 SDK 层引用它会破坏零耦合（必须先修）

实测：

```
$ python -c "import sys; from agenticx.runtime.replay_ledger.effects import classify_tool_effect; print(len([m for m in sys.modules if m.startswith('agenticx.studio')]))"
5
```

链路是：`from agenticx.runtime.replay_ledger.effects import ...` → 执行包 `__init__.py` → `agenticx/runtime/replay_ledger/__init__.py:17` `from ...store import ReplayLedgerStore` → `agenticx/runtime/replay_ledger/store.py:42` `from agenticx.studio.storage.factory import _default_sessions_root`。

`effects.py` 本身只依赖 `agenticx.runtime.command_safety`（纯 `re`/`shlex`/`dataclasses`/`typing`，零耦合），**是包 `__init__` 把 Studio 拖进来的**。

对照：`agenticx.runtime.interrupted_closers` 实测 0 个 Studio 模块，所以 Subplan 02 引用它是安全的；`replay_ledger` 这条路不安全。

### 1.3 「能不能重跑」目前无人判断

`agenticx/runtime/interrupted_closers.py` 只做到「告诉模型这次结果未知，你自己先只读核验」——是**概率性的自然语言约束**，不是机制。`replay_ledger` 的 `branchable` / `unbranchable_reason` 解决的是「能不能从这个历史事件分叉」，与「崩溃后这个已派发的工具能不能重跑」是两个不同问题（前者是用户主动操作的前向分支，后者是恢复时的被动决策），不能混用。

上游 openai-agents-python 的做法值得参照：分层否决（`replay_safety` / `response_started` / `stateful_request` / `_hard_veto` / `_delegable_replay_veto`），加一个 `approve_unsafe_replay` 逃生口，且该逃生口**对流式已开始的请求无效**。我们要的是同一形状，但对齐我们自己的分类法。

---

## 2. In scope / Out of scope

### In scope

**新增：**
- `agenticx/reliability/replay_policy.py`
- `tests/test_reliability_replay_policy.py`

**修改（仅这几处，逐行精确改）：**
- `agenticx/runtime/replay_ledger/__init__.py`（把 `ReplayLedgerStore` 改为惰性 `__getattr__`；**不动** contracts 的那批导入）
- `agenticx/tools/base.py`（`BaseTool` 新增一个类属性 + 一个 `resolve_effect_class()` 方法；**不动** `__init__` 签名、不动 `_validate_args`、不动 `run`/`arun`）
- `agenticx/agents/react_agent_async.py`（`aresume()` 的判决分支改为调用 policy）
- `agenticx/reliability/__init__.py`（追加导出）

### Out of scope

- **不改** `agenticx/runtime/replay_ledger/effects.py` 的任何分类规则、白名单、正则。想加工具就在业务侧用 `BaseTool.effect_class` 声明，不要往白名单里塞。
- **不改** `agenticx/runtime/replay_ledger/store.py` / `recorder.py` / `branch_service.py` / `contracts.py`。
- **不改** `agenticx/runtime/command_safety.py`（`assess_command` 是安全关键路径，本 Subplan 只读它的结论）。
- **不改** `agenticx/runtime/agent_runtime.py`、不改 `agenticx/studio/**`。
- 不做「用户在 UI 上确认要不要重跑」的交互（那是产品侧后续事项）；本 plan 只提供 `approve_unsafe_replay` 这个 API 级逃生口。
- 不做分布式租约 / 跨进程 CAS。
- 不新增第三方依赖。

---

## 3. t1：惰性化 `replay_ledger/__init__.py`

**改法**：把第 17 行的 eager import 换成 `__getattr__`，与 `agenticx/runtime/__init__.py:23` 已经在用的模式完全一致（那里 `AgentRuntime` / `AgentTeamManager` 等十几个符号都是这么惰性化的，直接照抄形状）。

**before**：
```python
from agenticx.runtime.replay_ledger.store import ReplayLedgerStore

__all__ = [..., "ReplayLedgerStore", ...]
```

**after**：
```python
def __getattr__(name: str):
    if name == "ReplayLedgerStore":
        from agenticx.runtime.replay_ledger.store import ReplayLedgerStore

        return ReplayLedgerStore
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")


__all__ = [..., "ReplayLedgerStore", ...]   # __all__ 保持不变
```

`contracts` 的那 8 个符号继续 eager 导入（`contracts.py` 只依赖 `re`/`dataclasses`/`typing`，无害）。

**为什么这不是 scope creep**：master plan 的 AC-M5 要求 `agenticx.reliability` 零 Studio 耦合。要么惰性化这一处（约 8 行，沿用既有模式），要么把分类逻辑复制一份到 `agenticx/reliability/`。复制会产生两份必然漂移的安全白名单——那才是真正的技术债。选前者。

**必须验证既有调用方不破**：
```bash
rg -n "from agenticx.runtime.replay_ledger import|replay_ledger import ReplayLedgerStore" --glob '!**/__pycache__/**'
pytest tests/test_replay_ledger_store.py tests/test_replay_ledger_recorder.py tests/test_run_replay_api.py tests/test_run_branch_api.py tests/test_run_branch_service.py tests/test_run_replay_export.py tests/test_run_context_checkpoint.py tests/test_run_workspace_snapshot.py tests/test_ha_checkpoint_resume.py tests/test_session_manager_persistence.py -q
```
以上测试**必须零修改通过**。`__getattr__` 惰性化对 `from X import Y` 和 `X.Y` 两种写法都透明，理论上无破坏；跑一遍是为了拿到证据，不是走形式。

---

## 4. t2：`BaseTool.effect_class`

在 `agenticx/tools/base.py` 的 `BaseTool` 类体内（放在 `__init__` **之前**，与 `ToolError` 等定义同风格）新增：

```python
class BaseTool(ABC):
    ...
    #: Optional declaration of this tool's side-effect class, used by
    #: ``agenticx.reliability.replay_policy`` to decide whether a call may be
    #: re-executed after a crash. ``None`` means "no declaration" and falls
    #: back to name/command based classification, which itself defaults to
    #: ``"unknown"`` (fail-closed). Valid values: the members of
    #: ``agenticx.runtime.replay_ledger.contracts.EFFECT_CLASSES``.
    effect_class: Optional[str] = None

    def resolve_effect_class(self, arguments: Optional[Dict[str, Any]] = None) -> str:
        """Return the effective side-effect class for one invocation.

        Resolution order (first hit wins):
          1. this instance's / subclass's ``effect_class`` declaration
          2. name & command based classification (``classify_tool_effect``)
          3. ``"unknown"`` — never assume safety for an unrecognised tool
        """
```

实现要点：
- 声明值必须校验在 `EFFECT_CLASSES` 内；不在则 **抛 `ValueError`**（配错分类比不配更危险，不能静默降级）。
- `classify_tool_effect` 用**函数内 import**，理由：`agenticx.tools.base` 是被广泛 import 的底层模块，模块级 import `agenticx.runtime.*` 会引入 `tools → runtime` 的方向依赖。这是 `no-inline-imports` 规则里明确允许的「有循环依赖理由且需注明」的例外，代码里写一行注释说明。
- 分类结果**不缓存**：`bash_exec` 的分类依赖 `arguments["command"]`，缓存会串味。

**不要做的事**：不要给现有任何工具类批量加 `effect_class` 声明。名字表已经覆盖了内置工具；逐个手工标注是后续独立事项，在这里做会让 diff 失控。

---

## 5. t3：`agenticx/reliability/replay_policy.py`

### 5.1 决策输入

```python
@dataclass(frozen=True)
class ReplayRequest:
    """Everything needed to decide whether one interrupted call may re-run."""

    call_id: str
    tool_name: str
    arguments: dict[str, Any]
    ledger_verdict: "Verdict"          # from Subplan 01
    effect_class: str                  # from BaseTool.resolve_effect_class()
    output_already_emitted: bool = False   # a FinalEvent / token stream已发给用户
    request_is_streaming: bool = False     # 本轮走的是流式请求
    approve_unsafe_replay: bool = False    # 调用方显式授权
```

### 5.2 决策输出

```python
ReplayAction = Literal["replay", "skip_use_recorded", "mark_unknown", "abort"]


@dataclass(frozen=True)
class ReplayDecision:
    action: ReplayAction
    veto: str | None            # 命中的否决层名；None 表示允许重跑
    reason: str                 # 面向人的一句话理由（进日志与 tool 消息）
    approved_override: bool = False   # 是否靠 approve_unsafe_replay 放行
```

四个动作的含义：

| action | 做什么 |
|---|---|
| `replay` | 重新执行该工具 |
| `skip_use_recorded` | 不执行，直接用账本里记录的结果补 tool 消息行 |
| `mark_unknown` | 不执行，补一条「结果未知，先只读核验」的 tool 行（复用 `OUTCOME_UNKNOWN_CONTENT`） |
| `abort` | 不可恢复，抛异常终止恢复流程 |

### 5.3 分层否决（严格按此顺序，短路返回）

```python
def decide_replay(req: ReplayRequest) -> ReplayDecision:
```

| 序 | 否决层名 | 触发条件 | action | 可否被 approve 覆盖 |
|---|---|---|---|---|
| 1 | `identity_conflict` | `ledger_verdict is Verdict.IDENTITY_CONFLICT` | `abort` | **否** |
| 2 | `output_already_emitted` | `req.output_already_emitted` | `mark_unknown` | **否**（对齐上游：流式已开始则逃生口无效） |
| 3 | `streaming_request` | `req.request_is_streaming and not req.output_already_emitted` 且 verdict 为 `AMBIGUOUS` | `mark_unknown` | **否** |
| 4 | `recorded_result_available` | `ledger_verdict is Verdict.REPLAY_SKIP` | `skip_use_recorded` | n/a（这是好路径，不是否决） |
| 5 | `external_side_effect` | `effect_class == "external_write"` 且 verdict 为 `AMBIGUOUS` | `mark_unknown` | 是 |
| 6 | `unknown_side_effect` | `effect_class == "unknown"` 且 verdict 为 `AMBIGUOUS` | `mark_unknown` | 是 |
| 7 | `local_write_ambiguous` | `effect_class == "local_write"` 且 verdict 为 `AMBIGUOUS` | `mark_unknown` | 是 |
| — | （无否决） | verdict 为 `FRESH`；或 verdict 为 `AMBIGUOUS` 且 `effect_class in {"none","read"}` | `replay` | n/a |

**层 1/2/3 是 hard veto**：即使 `approve_unsafe_replay=True` 也照旧否决，且返回的 `ReplayDecision.reason` 必须说明「授权已被忽略，因为 <理由>」，不能静默忽略用户的授权（用户会以为生效了）。

**层 5/6/7 被 approve 覆盖时**：返回 `ReplayDecision(action="replay", veto=<原否决层名>, reason="调用方显式授权重放（原否决：…）", approved_override=True)`。保留 `veto` 字段是为了审计——事后要能查出哪些重放是被人工放行的。

**`FRESH` 为什么无条件 replay**：账本证明这次调用**没有成功派发**（`record_dispatch` 在 `asyncio.gather` 之前、且带 fsync，见 Subplan 01）。没派发就没副作用，重跑安全。这是整套机制成立的支点，代码里写注释标明。

### 5.4 理由文案

`reason` 必须是可直接给人看的中文短句，且**包含工具名**。示例（照抄）：

- `identity_conflict` → `f"工具 {tool_name} 的调用 {call_id} 参数与账本记录不一致，无法安全恢复"`
- `output_already_emitted` → `f"本轮输出已发给用户，不能重跑 {tool_name}（授权已忽略）"`
- `external_side_effect` → `f"{tool_name} 会产生外部副作用且执行结果未知，已跳过重跑"`
- `unknown_side_effect` → `f"{tool_name} 的副作用未知（未声明 effect_class），保守跳过重跑"`
- `recorded_result_available` → `f"{tool_name} 已在中断前完成，复用已记录结果"`
- 无否决 → `f"{tool_name} 未成功派发，可安全重跑"` / `f"{tool_name} 为只读操作，可安全重跑"`

这批文案直接支撑 master plan 的 AC-M4（错误可诊断率）。

---

## 6. t5：接入 `aresume()`

把 Subplan 02 第 5 节 `aresume()` 里 `phase == "tools_dispatched"` 那段的**判决部分**替换为：

```python
for pc in state.pending_calls:
    verdict = ledger.reconcile_safe(pc.call_id, pc.tool_name, pc.arguments) if ledger else Verdict.AMBIGUOUS
    tool = self._tools_by_name.get(pc.tool_name)
    effect = tool.resolve_effect_class(pc.arguments) if tool is not None else "unknown"
    decision = decide_replay(ReplayRequest(
        call_id=pc.call_id,
        tool_name=pc.tool_name,
        arguments=pc.arguments,
        ledger_verdict=verdict,
        effect_class=effect,
        output_already_emitted=state.phase == "completed",
        request_is_streaming=True,          # ReActAgent.astream 始终流式
        approve_unsafe_replay=approve_unsafe_replay,
    ))
    # 按 decision.action 分派：replay / skip_use_recorded / mark_unknown / abort
```

`aresume()` 新增 keyword-only 参数 `approve_unsafe_replay: bool = False`。

`mark_unknown` 分支写入的 tool 消息行，`content` 用 `decision.reason` **加** `OUTCOME_UNKNOWN_CONTENT`（先说具体原因，再给通用的只读核验指引），`metadata` 带 `{"kind": KIND_OUTCOME_UNKNOWN, "veto": decision.veto}`。

`abort` 分支抛 `ToolCallIdentityError`（Subplan 01 已定义）。

**注意**：`self._tools_by_name` 若 `ReActAgent` 里没有这个映射，用现有的工具查找方式（读 `react_agent_async.py` 里 `_execute_one_tool` 怎么找工具的，照同一路径），不要新建索引结构。

---

## 7. 验收标准

### AC-1：零耦合（最硬的一条，先跑）

```bash
python -c "
import sys
from agenticx.reliability.replay_policy import decide_replay
bad = sorted(m for m in sys.modules if m.startswith('agenticx.studio'))
assert not bad, bad
print('OK, agenticx modules:', len([m for m in sys.modules if m.startswith('agenticx')]))
"
```
必须退出码 0。这是 t1 惰性化是否成功的唯一判据。

### AC-2：既有 replay_ledger 测试零修改通过

见第 3 节的 pytest 命令，10 个测试文件全绿。

### AC-3：`tests/test_reliability_replay_policy.py`

| 测试名 | 断言 |
|---|---|
| `test_fresh_always_replays` | `FRESH` + 任意 `effect_class`（含 `external_write`）→ `action == "replay"`，`veto is None` |
| `test_replay_skip_uses_recorded` | `REPLAY_SKIP` → `action == "skip_use_recorded"` |
| `test_identity_conflict_aborts` | `IDENTITY_CONFLICT` → `action == "abort"`，`veto == "identity_conflict"` |
| `test_identity_conflict_ignores_approval` | 同上 + `approve_unsafe_replay=True` → 仍 `abort`；`reason` 含「已忽略」 |
| `test_output_emitted_hard_veto` | `AMBIGUOUS` + `output_already_emitted=True` + `approve=True` + `effect_class="read"` → `mark_unknown`，`approved_override is False` |
| `test_ambiguous_read_replays` | `AMBIGUOUS` + `effect_class="read"` → `replay` |
| `test_ambiguous_none_replays` | `AMBIGUOUS` + `effect_class="none"` → `replay` |
| `test_ambiguous_external_write_marks_unknown` | `AMBIGUOUS` + `external_write` → `mark_unknown`，`veto == "external_side_effect"` |
| `test_ambiguous_unknown_marks_unknown` | `AMBIGUOUS` + `unknown` → `mark_unknown`，`veto == "unknown_side_effect"` |
| `test_ambiguous_local_write_marks_unknown` | `AMBIGUOUS` + `local_write` → `mark_unknown` |
| `test_approval_overrides_soft_veto` | `AMBIGUOUS` + `external_write` + `approve=True` + `output_already_emitted=False` + `request_is_streaming=False` → `replay`，`approved_override is True`，`veto == "external_side_effect"`（保留审计痕迹） |
| `test_reason_contains_tool_name` | 遍历上述所有分支，断言 `tool_name in decision.reason` |
| `test_veto_order_identity_before_output` | 同时构造 `IDENTITY_CONFLICT` + `output_already_emitted=True` → `veto == "identity_conflict"`（顺序不能反） |

### AC-4：`resolve_effect_class` 解析顺序

在同一测试文件内：

| 测试名 | 断言 |
|---|---|
| `test_declared_effect_class_wins` | 子类声明 `effect_class = "read"` 但工具名叫 `send_email` → 解析结果 `"read"` |
| `test_falls_back_to_classifier` | 未声明 + `name="file_read"` → `"read"`；`name="git_push"` → `"external_write"` |
| `test_bash_exec_uses_command` | 未声明 + `name="bash_exec"` + `{"command": "git push origin main"}` → `"external_write"`；`{"command": "ls -la"}` → `"read"` |
| `test_unknown_tool_is_unknown` | 未声明 + `name="my_custom_thing"` → `"unknown"` |
| `test_invalid_declaration_raises` | 声明 `effect_class = "totally_bogus"` → `resolve_effect_class()` 抛 `ValueError` |

### AC-5：端到端（接 Subplan 02 的测试）

在 `tests/test_react_agent_resume.py` 追加：

| 测试名 | 断言 |
|---|---|
| `test_resume_external_write_not_replayed` | `CounterTool` 声明 `effect_class = "external_write"`，账本状态为 `dispatched`（结果未知）→ `aresume` 后计数器**不变**，messages 里出现含 `external_side_effect` veto 的 tool 行 |
| `test_resume_read_tool_replayed` | 同场景但声明 `effect_class = "read"` → 计数器 +1 |
| `test_resume_with_approval_replays` | `external_write` + `aresume(approve_unsafe_replay=True)` → 计数器 +1 |

### AC-6：整体

```bash
pytest tests/test_reliability_replay_policy.py tests/test_react_agent_resume.py tests/test_reliability_ledger.py tests/test_reliability_call_identity.py tests/test_reliability_run_state.py -q
git diff --name-only    # 与第 2 节 In scope 逐条对齐
```

---

## 8. no-scope-creep 边界

改动文件白名单：

```
agenticx/reliability/replay_policy.py                 (新增)
agenticx/reliability/__init__.py                      (仅追加导出)
agenticx/runtime/replay_ledger/__init__.py            (仅惰性化 ReplayLedgerStore 一处)
agenticx/tools/base.py                                (仅新增 effect_class 属性 + resolve_effect_class 方法)
agenticx/agents/react_agent_async.py                  (仅 aresume 判决分支 + 新增 approve_unsafe_replay 参数)
tests/test_reliability_replay_policy.py               (新增)
tests/test_react_agent_resume.py                      (追加 AC-5 的 3 个测试)
.cursor/plans/2026-09-12-sdk-reliability-kernel-master.plan.md  (修正 §2 表格中 replay_safety → effect_class)
```

明确禁止：
- 不要给 `effects.py` 的白名单加工具名——哪怕只加一个。
- 不要「顺便」把 `replay_ledger` 的 `branchable` 逻辑和本 plan 的否决层统一——两者语义不同（前向分叉 vs 恢复重放），强行统一会引入错误。
- 不要动 `command_safety.py`。
- 不要给现有工具类批量标注 `effect_class`。
- 不要在 `agenticx/tools/base.py` 里做模块级 `import agenticx.runtime.*`（会引入方向反了的依赖），只能函数内 import 并注明理由。
