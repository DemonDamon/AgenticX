---
name: sdk-reliability-04-fault-injection-bench
overview: 把"更可靠"变成四个可复现的数字。仓库已有完整评测骨架（agenticx/evaluation/：EvalSet/EvalCase/EvalResult/EvalSummary + TrajectoryMatcher + EvalRunner），但它只度量正确性，没有任何故障注入；且 EvalRunner._execute_with_agent 是 duck-type 在 execute_async(query=, context=) 上的示意代码，与 ReActAgent.arun 不兼容。本 Subplan 新建 agenticx/evaluation/fault_injection.py（确定性故障注入 + 副作用计数 oracle）与 agenticx/evaluation/reliability_runner.py（直接驱动 ReActAgent 的姊妹 runner，复用 EvalSet/EvalResult/TrajectoryMatcher 数据模型，不改 EvalRunner），产出重复副作用率、崩溃恢复成功率、历史一致率、错误可诊断率四项指标与可复现报告。
todos:
  - id: t1
    content: 新建 fault_injection.py：FaultSpec / 六种故障点 / FaultInjector
    status: pending
  - id: t2
    content: SideEffectCounter oracle（确定性可数副作用工具）
    status: pending
  - id: t3
    content: ReliabilityCase / ReliabilityMetrics 数据模型（复用 EvalSet 家族）
    status: pending
  - id: t4
    content: ReliabilityRunner：注入 → 崩溃 → aresume → 判定
    status: pending
  - id: t5
    content: 四项指标计算与 to_report()
    status: pending
  - id: t6
    content: 内置基准用例集 + tests/test_reliability_bench.py 全绿
    status: pending
isProject: false
---

# Subplan 04：故障注入可靠性基准

**Plan-Id**: `2026-09-12-sdk-reliability-04-fault-injection-bench`
**Plan-File**: `.cursor/plans/2026-09-12-sdk-reliability-04-fault-injection-bench.plan.md`
**Master**: `2026-09-12-sdk-reliability-kernel-master`
**依赖**: Subplan 01、02、03 全部完成
**Planned-with**: Claude Opus 5
**Suggested-Impl-Model**: Grok 4.6
**Made-with**: Damon Li

---

## 1. 现状与根因

### 1.1 评测骨架已经存在，但只量正确性

`agenticx/evaluation/` 现有 7 个模块：

| 文件 | 提供什么 |
|---|---|
| `evalset.py` | `ExpectedToolUse` / `EvalCase` / `EvalResult` / `EvalSummary` / `EvalSet`（Pydantic `BaseModel`，含 `from_file`/`to_file`/`to_report`） |
| `trajectory_matcher.py` | `MatchMode`（EXACT/PARTIAL/UNORDERED）/ `TrajectoryMatcher` / `ToolCall` / `match_trajectory` |
| `runner.py` | `EvalRunner`（并发信号量、超时、回调、汇总） |
| `llm_judge.py` | `LLMJudge` / `CompositeJudge` / `MockLLMProvider` |
| `span_evaluator.py` | `SpanEvaluator` |
| `trace_converter.py` | `TraceToEvalSetConverter` |

`rg -n "fault|inject|crash|kill" agenticx/evaluation/` **零命中**。整套体系度量的是「工具调用轨迹对不对、回答好不好」，**完全不度量「崩了会怎样」**。

**所以本 Subplan 复用数据模型，不重造评测框架。**

### 1.2 但 `EvalRunner` 无法直接驱动 `ReActAgent`

`agenticx/evaluation/runner.py:261-291`：

```python
    async def _execute_with_agent(self, case: EvalCase) -> Dict[str, Any]:
        # 这里需要根据实际的 AgentExecutor 接口实现
        # 以下是示意代码
        ...
        if hasattr(self.agent_executor, 'execute_async'):
            result = await self.agent_executor.execute_async(
                query=case.query,
                context=case.initial_context
            )
```

它 duck-type 在 `execute_async(query=, context=)` 上，而 `ReActAgent` 的接口是 `arun(query, history=...)` / `astream(...)`（`agenticx/agents/react_agent_async.py:343`、`:220`）。两者不兼容，且注释自己写明是示意代码。

改 `EvalRunner` 去适配 `ReActAgent` 会动到一个被 `tests/` 依赖的既有类，风险与收益不成比例。**建姊妹 runner，`EvalRunner` 一行不动。**

### 1.3 可靠性无法自证

master plan 承诺的四个数字（重复副作用率、崩溃恢复成功率、历史一致率、错误可诊断率）现在**一个都测不出来**。Subplan 01–03 做完后机制存在了，但没有度量手段就无法对外声称领先，也无法在 Subplan 05 判断「翻默认值到底有没有用」。本 Subplan 是整个第一阶段的**验收仪器**。

---

## 2. In scope / Out of scope

### In scope

**新增：**
- `agenticx/evaluation/fault_injection.py`
- `agenticx/evaluation/reliability_runner.py`
- `agenticx/evaluation/benchmarks/reliability_v1.json`（内置基准用例集，`EvalSet` 格式）
- `tests/test_reliability_bench.py`

**修改：**
- `agenticx/evaluation/__init__.py`（仅追加导出）

### Out of scope

- **不改** `agenticx/evaluation/runner.py`（`EvalRunner` 一行不动）。
- **不改** `evalset.py` / `trajectory_matcher.py` / `llm_judge.py` / `span_evaluator.py` / `trace_converter.py`。若 `ReliabilityCase` 需要额外字段，用 `EvalCase.metadata`（已有的 `Dict[str, Any]` 字段）承载，**不给 `EvalCase` 加字段**。
- **不改** `agenticx/reliability/**`（Subplan 01–03 的产物在这里只被使用，不被修改；如果基准跑出来发现内核有 bug，回到对应 Subplan 修，不在这里打补丁）。
- **不改** `agenticx/agents/**`、`agenticx/runtime/**`、`agenticx/studio/**`。
- 不做真进程级 kill（`os.kill` / 子进程）。故障注入全部在**进程内模拟**：在指定边界抛特定异常 + 丢弃内存态 + 重建 agent 从磁盘 `aresume`。理由：真 kill 让测试变慢、变 flaky、且 CI 上难复现；进程内模拟已经能覆盖「内存态丢失、磁盘态是唯一真相」这个核心风险面。**这一点必须在报告里如实标注**，不要在对外材料里把它说成真崩溃演练。
- 不接真实 LLM。全部用确定性 FakeLLM（预设 tool_call 脚本）。基准必须**离线可跑、结果可复现**。
- 不做与上游 openai-agents-python 的横向对比跑分（那需要装它们的包、要真 API key，属后续独立事项）。本 Subplan 只产出 AgenticX 自己的绝对数字。
- 不新增第三方依赖。
- 不做性能/延迟基准。

---

## 3. `agenticx/evaluation/fault_injection.py`

### 3.1 故障点枚举

```python
class FaultKind(str, Enum):
    """Where a deterministic fault is injected during one run."""

    KILL_BEFORE_TOOL_RESULT = "kill_before_tool_result"
    KILL_AFTER_TOOL_RESULT_BEFORE_PERSIST = "kill_after_tool_result_before_persist"
    PERSIST_FAILURE = "persist_failure"
    LLM_TIMEOUT_MID_STREAM = "llm_timeout_mid_stream"
    DUPLICATE_TOOL_CALL_ID = "duplicate_tool_call_id"
    CHANGED_ARGS_SAME_ID = "changed_args_same_id"
```

每种故障要注入在哪、期望系统怎么表现：

| FaultKind | 注入点 | 期望行为（判定依据） |
|---|---|---|
| `KILL_BEFORE_TOOL_RESULT` | 工具已派发（账本已 `record_dispatch`），结果返回前抛 `_InjectedCrash` | `aresume` 后：`external_write`/`unknown` 类工具**不重跑**（副作用计数不增），补 `mark_unknown` 行；`read` 类可重跑 |
| `KILL_AFTER_TOOL_RESULT_BEFORE_PERSIST` | 工具已返回、`record_result` 已 fsync，但 `RunStateStore.save` 之前崩 | `aresume` 后判决 `REPLAY_SKIP`，**副作用计数不增**，且 messages 里的 tool 行内容 == 崩溃前的真实结果 |
| `PERSIST_FAILURE` | monkeypatch `RunStateStore.save` 抛 `OSError`（模拟磁盘满/只读） | 异常必须**向上抛出**（不得被吞），且用户可见的错误信息里能定位到是持久化失败 |
| `LLM_TIMEOUT_MID_STREAM` | FakeLLM 在产出部分 token 后抛 `asyncio.TimeoutError` | 状态落在 `before_llm` 或 `interrupted`；`aresume` 后能继续，且**不重复执行任何工具** |
| `DUPLICATE_TOOL_CALL_ID` | FakeLLM 在同一轮返回两个 `id` 相同、参数**也相同**的 tool_call | 第二个走 `REPLAY_SKIP`，副作用计数只 +1 |
| `CHANGED_ARGS_SAME_ID` | FakeLLM 返回与账本已有记录同 `id` 但参数不同的 tool_call | 抛 `ToolCallIdentityError`，错误信息含 call_id 与变化字段名（对齐 Subplan 01 的 AC-M4） |

### 3.2 `FaultSpec` 与 `FaultInjector`

```python
@dataclass(frozen=True)
class FaultSpec:
    kind: FaultKind
    #: 1-based index of the tool call at which to fire (0 = fire on the first
    #: matching boundary regardless of index).
    at_call_index: int = 1
    #: Fire only when the dispatched tool has this name; None = any tool.
    tool_name: str | None = None


class _InjectedCrash(BaseException):
    """Simulated process death.

    Deliberately derives from BaseException, not Exception, so that ordinary
    ``except Exception`` handlers inside the agent cannot swallow it — a real
    process kill is not catchable either.
    """


class FaultInjector:
    """Deterministic, single-shot fault injection around a ReActAgent run."""

    def __init__(self, spec: FaultSpec) -> None: ...

    def should_fire(self, *, boundary: str, call_index: int, tool_name: str) -> bool:
        """True at most once per injector instance."""

    @property
    def fired(self) -> bool: ...
```

**`_InjectedCrash` 继承 `BaseException` 是关键设计**：`ReActAgent._execute_one_tool` 与 `astream` 里有 `except Exception` 块，如果注入的异常继承 `Exception`，会被当成普通工具失败处理掉，测出来的就不是崩溃恢复而是错误处理。代码里写注释说明这一点。

`should_fire` 必须**单次触发**（`self._fired` 标志），否则 `aresume` 之后会二次崩溃，测试变成死循环。

### 3.3 副作用 oracle

```python
class SideEffectCounter:
    """Process-local, deterministic side-effect ledger used as the bench oracle.

    A "side effect" here is one append to ``self.records``. Because the bench
    runs offline with no real external calls, this counter IS the ground truth
    for "did we do it twice".
    """

    def __init__(self) -> None:
        self.records: list[tuple[str, str]] = []   # (op_key, payload_digest)

    def apply(self, op_key: str, payload: dict) -> str:
        """Record one effect and return a deterministic result string."""

    @property
    def duplicate_count(self) -> int:
        """Number of records beyond the first for any repeated op_key."""


class CountingTool(BaseTool):
    """BaseTool wrapper around SideEffectCounter, used by bench cases.

    ``effect_class`` is settable per instance so one case can exercise the
    read / local_write / external_write / unknown branches of
    agenticx.reliability.replay_policy.
    """
```

`duplicate_count` 的定义必须精确：按 `op_key` 分组，`sum(max(0, len(group) - 1))`。这是「重复副作用率」的分子。

---

## 4. `agenticx/evaluation/reliability_runner.py`

### 4.1 用例模型（复用 `EvalCase`，不改它）

```python
@dataclass(frozen=True)
class ReliabilityCase:
    """One fault-injection scenario.

    Serialises into a standard ``EvalCase`` whose ``metadata`` carries the
    fault spec, so a reliability benchmark is still a plain EvalSet on disk
    and can be loaded by EvalSet.from_file().
    """

    id: str
    query: str
    fault: FaultSpec
    #: FakeLLM script: list of rounds, each round a list of
    #: {"id": str, "name": str, "arguments": dict} or {"final": str}
    llm_script: list[list[dict[str, Any]]]
    tool_effect_class: str = "external_write"
    expected_total_effects: int = 1
    expect_resume_success: bool = True
    expect_error_diagnosable: bool = False

    def to_eval_case(self) -> "EvalCase": ...
    @classmethod
    def from_eval_case(cls, case: "EvalCase") -> "ReliabilityCase": ...
```

`to_eval_case()` 把 `fault` / `llm_script` / 各 `expect_*` 塞进 `EvalCase.metadata["reliability"]`。这样 `agenticx/evaluation/benchmarks/reliability_v1.json` 就是一个合法 `EvalSet`，能被既有 `EvalSet.from_file()` 读，也能被既有工具链看见——**不引入第二种磁盘格式**。

### 4.2 指标

```python
@dataclass
class ReliabilityMetrics:
    """The four numbers that define "AgenticX SDK leads on reliability"."""

    total_cases: int
    #: 分子 = 各用例 SideEffectCounter.duplicate_count 之和
    #: 分母 = 各用例 expected_total_effects 之和
    duplicate_side_effect_rate: float
    #: 分子 = aresume 后成功走到 FinalEvent 且未抛未预期异常的用例数
    #: 分母 = expect_resume_success is True 的用例数
    crash_recovery_success_rate: float
    #: 分子 = 恢复后 messages 通过一致性校验的用例数（见 4.4）
    #: 分母 = 成功恢复的用例数
    history_consistency_rate: float
    #: 分子 = 失败/否决路径上，用户可见文本同时包含工具名与具体原因的用例数
    #: 分母 = 预期产生失败/否决的用例数
    error_diagnosability_rate: float

    per_case: list[dict[str, Any]] = field(default_factory=list)

    def to_report(self) -> str:
        """Markdown report; mirrors EvalSummary.to_report() style."""
```

四个指标的**方向性**必须在 `to_report()` 里写清楚，避免读者误读：

- `duplicate_side_effect_rate`：**越低越好**，目标 `0.0`
- `crash_recovery_success_rate`：**越高越好**，目标 `1.0`
- `history_consistency_rate`：**越高越好**，目标 `1.0`
- `error_diagnosability_rate`：**越高越好**，目标 `1.0`

`to_report()` 还必须包含一段**方法论声明**（原文照写，不要美化）：

> 本基准为**进程内模拟崩溃**（在指定边界抛不可捕获异常并丢弃内存态，从磁盘状态重建），非真实进程 kill。指标反映"内存态丢失后磁盘态能否独立支撑正确恢复"，不覆盖 OS 级页缓存丢失、磁盘损坏等物理故障。

### 4.3 执行流程

```python
class ReliabilityRunner:
    """Drives ReActAgent through fault-injection cases.

    Sibling of EvalRunner (which is duck-typed on execute_async and cannot
    drive ReActAgent); reuses EvalSet/EvalCase/EvalResult data models and
    TrajectoryMatcher, but owns its own execution loop.
    """

    def __init__(self, *, root: Path, verbose: bool = False) -> None: ...

    async def run_case_async(self, case: ReliabilityCase) -> dict[str, Any]: ...
    async def run_async(self, evalset: "EvalSet") -> ReliabilityMetrics: ...
    def run(self, evalset: "EvalSet") -> ReliabilityMetrics: ...
```

单个用例的执行流程（**严格按此顺序**，每一步都是判定点）：

```
1. 建 tmp 目录：<root>/<case.id>/
2. counter = SideEffectCounter(); tool = CountingTool(counter, effect_class=case.tool_effect_class)
3. ledger = CallLedger(session_id=case.id, root=...)
   run_store = RunStateStore(session_id=case.id, root=...)
   llm = ScriptedFakeLLM(case.llm_script)
   agent = ReActAgent(llm=llm, tools=[tool], run_store=run_store, call_ledger=ledger)
4. injector = FaultInjector(case.fault)  并挂到 agent 的注入钩子上
5. phase_1 = 消费 agent.astream(case.query)，捕获 _InjectedCrash / OSError / TimeoutError
   - 记录：crashed(bool)、crash_exc、phase_1 事件序列
6. 丢弃全部内存态：del agent, ledger, run_store   （模拟进程死亡）
7. 重建（只从磁盘）：
   ledger2 = CallLedger(session_id=case.id, root=...)   # 会 load 已有 jsonl
   store2  = RunStateStore(session_id=case.id, root=...)
   agent2  = ReActAgent(llm=ScriptedFakeLLM(case.llm_script), tools=[tool],
                        run_store=store2, call_ledger=ledger2)
   注意：tool 与 counter 沿用同一实例——副作用计数必须跨"进程"累计，
        否则测不出重复副作用（这是本 Subplan 最容易写错的一步）
8. phase_2 = 消费 agent2.aresume()，捕获异常
9. 判定：
   - effects_total = len(counter.records)
   - duplicates = counter.duplicate_count
   - resume_ok = phase_2 里出现 FinalEvent(success=True) 且无未预期异常
   - history_ok = 见 4.4
   - diagnosable = 见 4.5
```

**第 7 步的 `tool`/`counter` 复用是本 Subplan 的核心 trick**，注释里必须写明理由：真实世界里外部副作用（发出去的消息、写下的文件）不会随进程死亡而回滚，所以 oracle 也不能重置。

`ScriptedFakeLLM` 在 `fault_injection.py` 里实现，接口对齐 `ReActAgent` 期望的 `_ainvoke` 契约（读 `react_agent_async.py:_ainvoke` 实际怎么调 llm，照它的形状实现，不要猜）。

### 4.4 历史一致性校验

`history_ok` 为 True 需**同时**满足（逐条断言，任一不满足即为 False）：

1. 每个 `assistant` 消息里的每个 `tool_calls[i].id`，在后续 `messages` 中都有**恰好一条** `role == "tool"` 且 `tool_call_id` 相同的行（不多不少）。
2. 没有任何 `tool_call_id` 为空串或 `None` 的 `tool` 行。
3. `tool` 行的相对顺序与对应 `assistant.tool_calls` 的顺序一致。
4. 没有连续两条 `role == "assistant"` 且中间夹着未闭合的 `tool_calls`。

这四条正是 `agenticx/runtime/agent_runtime.py` 花大量代码在 Studio 侧维护的「provider 400 防护」不变量（见 `conclusions/runtime_module_conclusion.md`）。SDK 侧必须自己达标。

### 4.5 错误可诊断性判定

对 `expect_error_diagnosable is True` 的用例，收集所有「用户可见文本」：`ErrorEvent.message`、`mark_unknown` 分支写入的 tool 行 `content`、向上抛出的异常的 `str()`。

`diagnosable` 为 True 需满足：
1. 文本非空，且**不是**裸类型名（排除 `"'_type'"`、`"KeyError"`、`"OSError"` 这类单 token —— 这是用户明确反馈过的坏体验）；
2. 包含涉事**工具名**；
3. 包含一个具体原因短语（`veto` 名或「持久化失败」「参数不一致」等）。

实现一个 `_is_diagnosable(text: str, *, tool_name: str) -> bool` 辅助函数并单独测它。

### 4.6 内置基准用例集

`agenticx/evaluation/benchmarks/reliability_v1.json`，`EvalSet` 格式，`name = "agenticx-reliability-v1"`，**至少 12 个用例**，覆盖矩阵：

| # | FaultKind | tool_effect_class | expected_total_effects | expect_resume_success | expect_error_diagnosable |
|---|---|---|---|---|---|
| 1 | `KILL_BEFORE_TOOL_RESULT` | `external_write` | 1 | True | True |
| 2 | `KILL_BEFORE_TOOL_RESULT` | `read` | 2 | True | False |
| 3 | `KILL_BEFORE_TOOL_RESULT` | `unknown` | 1 | True | True |
| 4 | `KILL_BEFORE_TOOL_RESULT` | `local_write` | 1 | True | True |
| 5 | `KILL_AFTER_TOOL_RESULT_BEFORE_PERSIST` | `external_write` | 1 | True | False |
| 6 | `KILL_AFTER_TOOL_RESULT_BEFORE_PERSIST` | `local_write` | 1 | True | False |
| 7 | `PERSIST_FAILURE` | `read` | 1 | False | True |
| 8 | `LLM_TIMEOUT_MID_STREAM` | `external_write` | 1 | True | False |
| 9 | `LLM_TIMEOUT_MID_STREAM` | `read` | 1 | True | False |
| 10 | `DUPLICATE_TOOL_CALL_ID` | `external_write` | 1 | True | False |
| 11 | `CHANGED_ARGS_SAME_ID` | `external_write` | 1 | False | True |
| 12 | 多轮：2 工具，第 2 个后崩 | `external_write` | 2 | True | False |

用例 2 的 `expected_total_effects = 2` 是**有意的**：`read` 类工具允许重跑，所以计数会到 2，但这**不算 duplicate**——`duplicate_side_effect_rate` 的分子只统计 `counter.duplicate_count`（同 `op_key` 重复），而重跑用的 `op_key` 应与原调用相同，所以会被算成 duplicate。**这里有个设计决策**：`read` 类工具重跑属预期行为，不应污染重复副作用率。解决办法：`CountingTool` 在 `effect_class == "read"` 时**不**写入 `counter.records`，改写入 `counter.reads`（另一个列表）。`duplicate_count` 只看 `records`。实施时按此办，并在 `SideEffectCounter` 的 docstring 里写明。

### 4.7 `__init__.py` 追加导出

```python
from .fault_injection import (
    FaultKind, FaultSpec, FaultInjector, SideEffectCounter, CountingTool, ScriptedFakeLLM,
)
from .reliability_runner import ReliabilityCase, ReliabilityMetrics, ReliabilityRunner
```
并加入 `__all__`。**保持现有导出顺序与内容不变，只在末尾追加。**

---

## 5. 验收标准

### AC-1：`tests/test_reliability_bench.py` — 组件级

| 测试名 | 断言 |
|---|---|
| `test_injector_fires_once` | `should_fire` 连续调用 5 次只有第 1 次返回 True；`fired` 变 True |
| `test_injector_respects_call_index` | `at_call_index=2` → 第 1 次 False、第 2 次 True |
| `test_injector_respects_tool_name` | `tool_name="bump"` → 别的工具名不触发 |
| `test_injected_crash_not_caught_by_except_exception` | `try: raise _InjectedCrash() except Exception: pytest.fail()` 能穿透 |
| `test_counter_duplicate_count` | 同 `op_key` 写 3 次 → `duplicate_count == 2`；不同 key 各 1 次 → `0` |
| `test_counter_read_not_counted` | `effect_class="read"` 的 `CountingTool` 调 3 次 → `duplicate_count == 0`，`len(counter.reads) == 3` |
| `test_reliability_case_roundtrip` | `ReliabilityCase.from_eval_case(c.to_eval_case())` 与 `c` 等价 |
| `test_benchmark_json_is_valid_evalset` | `EvalSet.from_file("agenticx/evaluation/benchmarks/reliability_v1.json")` 成功，`len(...) >= 12` |
| `test_is_diagnosable_rejects_bare_token` | `_is_diagnosable("'_type'", tool_name="bump") is False`；`_is_diagnosable("KeyError", ...) is False` |
| `test_is_diagnosable_accepts_full_reason` | `_is_diagnosable("bump 会产生外部副作用且执行结果未知，已跳过重跑", tool_name="bump") is True` |
| `test_history_check_detects_orphan_tool_row` | 构造缺失对应 `assistant.tool_calls` 的 tool 行 → 一致性校验返回 False |
| `test_history_check_detects_duplicate_tool_row` | 同一 `tool_call_id` 两条 tool 行 → False |
| `test_history_check_accepts_valid` | 合法 messages → True |

### AC-2：`tests/test_reliability_bench.py` — 端到端

| 测试名 | 断言 |
|---|---|
| `test_bench_runs_offline` | 跑完整 `reliability_v1.json`，全程无网络（`socket.socket` monkeypatch 成抛异常也能跑完） |
| `test_zero_duplicate_side_effects` | `metrics.duplicate_side_effect_rate == 0.0` |
| `test_full_crash_recovery` | `metrics.crash_recovery_success_rate == 1.0` |
| `test_full_history_consistency` | `metrics.history_consistency_rate == 1.0` |
| `test_full_error_diagnosability` | `metrics.error_diagnosability_rate == 1.0` |
| `test_metrics_report_contains_methodology` | `to_report()` 含「进程内模拟崩溃」字样（防止对外材料误宣传） |
| `test_bench_is_deterministic` | 连跑 2 次，四个指标与 `per_case` 逐字段一致 |
| `test_bench_uses_tmp_path` | 跑完后 `~/.agenticx/` 下无新增文件（全部落在 `tmp_path`） |

后四条中 `test_zero_duplicate_side_effects` 与 `test_full_crash_recovery` 直接对应 master plan 的 AC-M2/AC-M3。

**如果这两条跑不过，不要改测试或改基准去让它通过**——那说明 Subplan 01–03 的内核有缺陷，回到对应 Subplan 修根因。这是本 Subplan 存在的全部意义。

### AC-3：不污染既有评测

```bash
pytest tests/ -k "eval" -q          # 既有评测相关测试零修改通过
git diff --name-only agenticx/evaluation/   # 只应出现 __init__.py（追加）+ 3 个新文件
```

### AC-4：可复现命令（写进 plan，供后续引用）

```bash
python -m pytest tests/test_reliability_bench.py -q
python -c "
from pathlib import Path
from agenticx.evaluation import EvalSet, ReliabilityRunner
es = EvalSet.from_file('agenticx/evaluation/benchmarks/reliability_v1.json')
import tempfile
with tempfile.TemporaryDirectory() as d:
    print(ReliabilityRunner(root=Path(d)).run(es).to_report())
"
```
第二条命令的输出就是**对外可引用的可靠性数字**。Subplan 05 的决策依赖它。

---

## 6. no-scope-creep 边界

改动文件白名单：

```
agenticx/evaluation/fault_injection.py                  (新增)
agenticx/evaluation/reliability_runner.py               (新增)
agenticx/evaluation/benchmarks/reliability_v1.json      (新增)
agenticx/evaluation/__init__.py                         (仅末尾追加导出)
tests/test_reliability_bench.py                         (新增)
```

明确禁止：
- 不要「顺手修」`EvalRunner._execute_with_agent` 那段示意代码——它现在这样是既有状态，改它属另一件事。
- 不要给 `EvalCase` / `EvalResult` / `EvalSummary` 加字段（用 `metadata` 承载）。
- 不要修 `agenticx/reliability/**`。基准跑红就回上游 Subplan 修，不在这里绕过。
- 不要为了让指标好看而放宽 4.4 的一致性四条或 4.5 的可诊断三条。
- 不要引入 `pytest-asyncio` 之外的新测试依赖（先确认仓库已有的异步测试是怎么写的，照同一方式）。
- 不要跑真 LLM、不要读 `~/.agenticx/config.yaml`。
