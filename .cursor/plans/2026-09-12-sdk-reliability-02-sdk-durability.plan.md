---
name: sdk-reliability-02-sdk-durability
overview: 给可嵌入的 SDK 原语 ReActAgent 补上崩溃续跑能力。当前 agenticx/agents/react_agent_async.py（402 行）的 astream() 是纯内存循环，messages 是局部变量，进程一死全丢；CancelledError 分支只 yield ErrorEvent 就 raise，连已完成的工具结果一起丢弃。而唯一的 CheckpointStore 在 agenticx/runtime/checkpoint.py 里 import agenticx.studio.storage，无法复用（会破坏 SDK 零 Studio 耦合契约）。本 Subplan 新建 agenticx/reliability/run_state.py 提供与 Studio 解耦的可序列化 RunState + 文件后端 RunStateStore，接入 ReActAgent 的 astream/arun 并新增 aresume()，同时修掉 tool_call id 在事件流与 messages 之间不自洽的既有缺陷（账本依赖稳定 id）。
todos:
  - id: t1
    content: 统一 ReActAgent 的 tool_call id 取法（stable_call_id 单一收口）
    status: pending
  - id: t2
    content: 新建 agenticx/reliability/run_state.py（RunState + RunStateStore）
    status: pending
  - id: t3
    content: ReActAgent 接入 run_store / ledger，在两个边界写检查点
    status: pending
  - id: t4
    content: 取消/中断时落盘部分状态并产出 InterruptedEvent
    status: pending
  - id: t5
    content: 实现 ReActAgent.aresume()（账本驱动的跳过与追问）
    status: pending
  - id: t6
    content: tests/test_reliability_run_state.py + tests/test_react_agent_resume.py 全绿
    status: pending
isProject: false
---

# Subplan 02：SDK 侧 RunState 持久化与续跑

**Plan-Id**: `2026-09-12-sdk-reliability-02-sdk-durability`
**Plan-File**: `.cursor/plans/2026-09-12-sdk-reliability-02-sdk-durability.plan.md`
**Master**: `2026-09-12-sdk-reliability-kernel-master`
**依赖**: Subplan 01 必须先完成（本 plan 使用 `CallLedger` / `canonical_call_key` / `stable_call_id`）
**Planned-with**: Claude Opus 5
**Suggested-Impl-Model**: Grok 4.6
**Made-with**: Damon Li

---

## 1. 要解决什么（根因与证据）

### 1.1 SDK 原语完全没有持久化

`agenticx/agents/react_agent_async.py` 全文 402 行，`rg 'checkpoint|persist|resume'` **零命中**。

具体看 `astream()`（`:220-341`）：

```220:232:agenticx/agents/react_agent_async.py
    async def astream(
        self,
        query: str,
        *,
        history: Optional[List[Dict[str, Any]]] = None,
    ) -> AsyncIterator[AgentEvent]:
        """Run the FC loop, yielding typed events (NFR-4 source of truth)."""
        self._stop_requested = False
        messages = self._build_messages(query, history)
        iterations = 0

        try:
            while iterations < self.max_iterations:
```

`messages` 是局部变量。进程崩溃后：已跑完的工具、已产生的副作用、已累积的对话历史，**全部无从得知**。

取消路径更糟：

```339:341:agenticx/agents/react_agent_async.py
        except asyncio.CancelledError:
            yield ErrorEvent(message="cancelled", recoverable=False)
            raise
```

`messages` 没有随事件流出，调用方拿不到任何可续跑的东西。对比 `agenticx/runtime/agent_runtime.py` 的 `_finalize_cancelled_prefix()`（受 `AGX_CANCELLED_PREFIX_FINALIZE` 控制，默认开）——Studio 侧考虑过这个问题，SDK 侧没有。

### 1.2 既有 CheckpointStore 不可复用

`agenticx/runtime/checkpoint.py:32-33`：

```python
from agenticx.studio.storage.backend import SyncStorageFacade
from agenticx.studio.storage.factory import get_sync_storage
```

`agenticx.agents` 若 import 它，就会反向依赖 `agenticx.studio`，破坏 `conclusions/agents_module_conclusion.md` 记录的既有契约（「不依赖 `AgentExecutor` 或任何 Studio/CLI 运行时」，且已有冒烟测试断言这一点）。所以必须在 `agenticx/reliability/` 里新写一个与 Studio 无关的存储。

另外 `CheckpointStore.save()` 的失败语义也不能照抄：

```73:88:agenticx/runtime/checkpoint.py
    def save(self, checkpoint: AgentCheckpoint) -> None:
        try:
            ...
        except Exception:
            logger.warning(
                "checkpoint save failed session=%s",
                checkpoint.session_id,
                exc_info=True,
            )
```

写失败被吞掉 → 运行照常继续 → 崩溃后无从恢复 → 没人知道。本 Subplan 的 `RunStateStore` 必须**抛出**。

### 1.3 tool_call id 在同一次调用里不自洽（必须先修）

同一个 `tc`，三处取 id 的方式不同：

```262:263:agenticx/agents/react_agent_async.py
                    args = _parse_tool_arguments(fn.get("arguments"))
                    tc_id = str(tc.get("id", "") or f"call_{name}_{iterations}")
```

```271:283:agenticx/agents/react_agent_async.py
                results = await asyncio.gather(
                    *[
                        self._execute_one_tool(
                            str(tc.get("id", "") or ""),
                            str((tc.get("function") or {}).get("name", "") or ""),
                            _parse_tool_arguments(
                                (tc.get("function") or {}).get("arguments"),
                            ),
                        )
                        for tc in pending
                    ],
                    return_exceptions=True,
                )
```

```287:288:agenticx/agents/react_agent_async.py
                    fn = tc.get("function") or {}
                    name = str(fn.get("name", "") or "")
                    tc_id = str(tc.get("id", "") or "")
```

`:263` 有 `f"call_{name}_{iterations}"` 兜底，`:275` 和 `:288` 没有。当 provider 不给 id（部分兼容代理会这样）时，事件流里的 id 是 `call_echo_1`，messages 里的是 `""`，账本会把不同调用全部记到空串键上。

**这不是 scope creep，是本 Subplan 的前置修复**：账本依赖稳定 id，id 不稳定则 Subplan 01 的全部保证失效。修法是引入单一收口（见第 4 节 t1）。

---

## 2. In scope / Out of scope

### In scope

**新增：**
- `agenticx/reliability/run_state.py`
- `tests/test_reliability_run_state.py`
- `tests/test_react_agent_resume.py`

**修改（仅这两个文件）：**
- `agenticx/agents/react_agent_async.py`
- `agenticx/agents/agent_events.py`（新增 1 个事件类型 `InterruptedEvent`，加入 `AgentEvent` 联合）
- `agenticx/reliability/__init__.py`（追加导出）

### Out of scope

- **不改** `agenticx/runtime/agent_runtime.py`（产品侧接入不在第一阶段）。
- **不改** `agenticx/runtime/checkpoint.py`（Studio 的 checkpoint 保持原样；两套并存是有意的）。
- **不改** `agenticx/runtime/interrupted_closers.py`。
- **不改** `agenticx/agents/react_agent.py`（legacy `TextReActAgent` 门面不动）。
- **不改** `agenticx/studio/**` 任何文件。
- 不做重放安全否决（Subplan 03）；本 plan 里所有 `AMBIGUOUS` 一律走「暴露给调用方 + 默认不重跑」的保守路径。
- 不做故障注入测试框架（Subplan 04）；本 plan 的测试用直接调用 `aresume()` 模拟崩溃。
- 不新增第三方依赖。
- `ReActAgent` 的既有构造参数与 `arun`/`astream`/`run` 签名**保持向后兼容**：所有新参数必须是 keyword-only 且有默认值，默认值下行为与现在**逐字节一致**（无 run_store 时不落盘、不产生新事件）。

---

## 3. 文件：`agenticx/reliability/run_state.py`

### 3.1 数据模型

```python
RUN_STATE_SCHEMA_VERSION = 1


@dataclass
class PendingCall:
    call_id: str
    tool_name: str
    arguments: dict[str, Any]
    canonical_key: str


@dataclass
class RunState:
    """Serializable snapshot of an in-flight ReActAgent run.

    Unlike ``agenticx.runtime.checkpoint.AgentCheckpoint`` this type has no
    Studio dependency and carries the full message list, so an embedder can
    resume without a session backend.
    """

    run_id: str
    session_id: str
    schema_version: int = RUN_STATE_SCHEMA_VERSION
    query: str = ""
    messages: list[dict[str, Any]] = field(default_factory=list)
    iteration: int = 0
    phase: Literal["before_llm", "tools_dispatched", "completed", "interrupted"] = "before_llm"
    pending_calls: list[PendingCall] = field(default_factory=list)
    created_at: float = 0.0
    updated_at: float = 0.0

    def to_dict(self) -> dict[str, Any]: ...
    @classmethod
    def from_dict(cls, raw: dict[str, Any]) -> "RunState": ...
```

`phase` 的语义（**这是恢复决策的唯一依据，不要引入第五个值**）：

| phase | 含义 | 恢复动作 |
|---|---|---|
| `before_llm` | 本轮 LLM 请求还没发出 | 直接从 `iteration` 继续，重发 LLM 请求（LLM 请求本身无外部副作用） |
| `tools_dispatched` | 工具已派发，结果未必回来 | 对每个 `pending_calls` 查账本判决（见第 5 节） |
| `completed` | 已产出 FinalEvent | 无需恢复；`aresume` 直接返回终态 |
| `interrupted` | 用户取消或 stop() | 保留 messages 供调用方决定是否续问 |

### 3.2 `RunStateStore`

```python
class RunStateStore:
    """File-backed RunState persistence (atomic replace, fail-closed)."""

    def __init__(self, session_id: str, *, root: str | Path | None = None) -> None:
        """Default root: ``~/.agenticx/sessions/<session_id>/`` via
        ``agenticx.utils.agx_home.agx_home()``. State file: ``run_state.json``.
        Rejects session_id containing '/', '\\' or '..' (same guard as
        CallLedger in Subplan 01)."""

    def save(self, state: RunState) -> None:
        """Atomically persist. RAISES on failure — never swallow.

        Uses ``agenticx.utils.atomic_writer.atomic_write_json`` so a crash
        mid-write cannot leave a truncated file.
        """

    def load(self) -> RunState | None:
        """Return None when absent. Raises ValueError when schema_version >
        RUN_STATE_SCHEMA_VERSION (refuse to guess a future format)."""

    def clear(self) -> None:
        """Delete the state file; missing file is not an error."""
```

**必须用** `agenticx.utils.atomic_writer.atomic_write_json`（该函数已存在于 `agenticx/utils/atomic_writer.py:32`）。不要自己写 `open(...).write()`——崩溃时会留下半截 JSON，恢复直接失败。

对比：`RunStateStore.save` 抛异常，`agenticx/runtime/checkpoint.py:73-88` 吞异常。这是刻意的差异，代码里加一行注释说明。

### 3.3 `__init__.py` 追加导出

```python
from agenticx.reliability.run_state import (
    RUN_STATE_SCHEMA_VERSION, PendingCall, RunState, RunStateStore,
)
```

---

## 4. 改造 `agenticx/agents/react_agent_async.py`

### t1：tool_call id 单一收口（先做，独立可验证）

新增一个私有辅助方法，把「从 provider 的 tc dict 里解析出规范三元组」收敛到一处：

```python
    def _normalize_tool_call(
        self,
        tc: Dict[str, Any],
        *,
        iteration: int,
        position: int,
    ) -> tuple[str, str, Dict[str, Any]]:
        """Return (stable_call_id, tool_name, arguments) for one provider tool_call.

        Single chokepoint: every id used in events, execution and the tool
        message row comes from here, so a ledger keyed on call_id stays valid
        even when the provider omits ids.
        """
        fn = tc.get("function") or {}
        name = str(fn.get("name", "") or "")
        args = _parse_tool_arguments(fn.get("arguments"))
        call_id = stable_call_id(
            tc.get("id"),
            tool_name=name,
            iteration=iteration,
            position=position,
        )
        return call_id, name, args
```

然后**把 `:259-319` 的三处解析全部替换为一次解析、结果复用**。改造后的结构（before → after 意图）：

**before**（现在的样子，三次独立解析）：
```
for tc in tool_calls:            # 解析第 1 次，id 有兜底
    ...yield ToolCallEvent(tc_id, ...)
results = await gather(          # 解析第 2 次，id 无兜底
    self._execute_one_tool(str(tc.get("id","") or ""), ...) for tc in pending
)
for tc, result in zip(...):      # 解析第 3 次，id 无兜底
    ...messages.append({"tool_call_id": tc_id, ...})
```

**after**（一次解析，三处复用）：
```
normalized = [
    self._normalize_tool_call(tc, iteration=iterations, position=i)
    for i, tc in enumerate(tool_calls)
]
for call_id, name, args in normalized:
    yield ToolCallEvent(tool_call_id=call_id, tool_name=name, arguments=args)

results = await asyncio.gather(
    *[self._execute_one_tool(call_id, name, args) for call_id, name, args in normalized],
    return_exceptions=True,
)

for (call_id, name, args), result in zip(normalized, results):
    ...
    messages.append({"role": "tool", "tool_call_id": call_id, "content": content})
    yield ToolResultEvent(tool_call_id=call_id, tool_name=name, content=content, success=success)
```

`pending` 这个中间列表随之删除（它只是 `tool_calls` 的副本，见 `:258` 与 `:264`）。

**注意**：`self.loop_detector.record_call(...)`（`:296-305`）的参数改为复用 `args`，不要再调 `_parse_tool_arguments(fn.get("arguments"))` 第四次。

### t3：构造参数与检查点写入

`__init__` 新增 keyword-only 参数（**加在现有参数之后，不改任何既有参数的顺序或默认值**）：

```python
        run_store: "RunStateStore | None" = None,
        call_ledger: "CallLedger | None" = None,
        run_id: str | None = None,
```

- 两者都为 `None`（默认）→ 行为与现在完全一致，零新增 IO、零新增事件。
- `run_store` 非 None → 在两个边界落盘。
- `call_ledger` 非 None → 记录 dispatch/result，并在 `aresume` 时用于判决。
- 允许只给 `run_store` 不给 `call_ledger`（此时恢复只能靠 `phase`，`tools_dispatched` 一律按 AMBIGUOUS 处理）；反之亦可。

**落盘点只有两个**，不要多加：

1. **发 LLM 请求之前**（现 `:243-244` 之间）：
   ```python
   messages = await self._maybe_compact(messages)
   self._save_state(phase="before_llm", messages=messages, iteration=iterations)
   response = await self._ainvoke(messages)
   ```
2. **工具派发之前**（yield 完 `ToolCallEvent`、gather 之前）：
   ```python
   self._save_state(
       phase="tools_dispatched",
       messages=messages,
       iteration=iterations,
       pending_calls=[PendingCall(call_id, name, args, canonical_call_key(name, args))
                      for call_id, name, args in normalized],
   )
   if self._ledger is not None:
       for call_id, name, args in normalized:
           self._ledger.record_dispatch(call_id, name, args)
   ```

工具结果回来后（每个 `zip` 迭代内）：
```python
   if self._ledger is not None:
       if success:
           self._ledger.record_result(call_id, content)
       else:
           self._ledger.record_failure(call_id, content)
```

产出 `FinalEvent` 之前：`self._save_state(phase="completed", ...)`；`FinalEvent` yield 之后调用 `self._run_store.clear()`（终态不留残留状态，否则下次 `aresume` 会误判有未完成的 run）。

`_save_state` 的实现：
```python
    def _save_state(self, *, phase, messages, iteration, pending_calls=()) -> None:
        if self._run_store is None:
            return
        state = RunState(
            run_id=self._run_id,
            session_id=self.session_id,
            query=self._current_query,
            messages=list(messages),
            iteration=iteration,
            phase=phase,
            pending_calls=list(pending_calls),
        )
        self._run_store.save(state)   # 故意不 try/except：写不进去就该炸
```

### t4：取消 / 中断落盘

改造 `:232-238` 的 stop 分支与 `:339-341` 的 `CancelledError` 分支：两处都先落盘 `phase="interrupted"`，再产出新的 `InterruptedEvent`（带 messages），`CancelledError` 分支仍然 `raise`。

`agenticx/agents/agent_events.py` 新增：

```python
@dataclass
class InterruptedEvent:
    """Run stopped before producing a final output; carries resumable state."""
    reason: Literal["user_stop", "cancelled"]
    messages: List[Dict[str, Any]] = field(default_factory=list)
    iteration: int = 0
    run_id: str = ""
```

并把它加入 `AgentEvent = Union[...]`。

> 事件类型上限：`conclusions/agents_module_conclusion.md` 记录「最小化（≤6 类）」。加上 `InterruptedEvent` 是 7 类。这是有意的扩张——「被中断且可续跑」是与 `ErrorEvent`（错误）语义不同的一等状态，不能复用 `ErrorEvent(recoverable=False)` 表达。实施时同步把该 conclusion 的「≤6 类」表述更新为 7 类（这是 conclusion 维护，不是 scope creep）。

`arun()` 里相应处理：遇到 `InterruptedEvent` 时把 `messages` 填进 `ReActResult.messages`，`success=False`，`error` 设为 `f"interrupted: {reason}"`。**不要**改 `ReActResult` 的字段。

### t5：`aresume()`

```python
    async def aresume(
        self,
        state: "RunState | None" = None,
    ) -> AsyncIterator[AgentEvent]:
        """Resume an interrupted run from persisted state.

        When ``state`` is None, loads from ``run_store``. Raises RuntimeError
        when neither is available.
        """
```

恢复流程（按 `phase` 分派，严格照做）：

```
state.phase == "completed"
    -> yield FinalEvent(output=<last assistant content>, success=True,
                        messages=state.messages, iterations=state.iteration)
       return

state.phase in ("before_llm", "interrupted")
    -> messages = state.messages
       iterations = state.iteration
       进入与 astream 相同的主循环（从 iterations 继续，不 +1）
       # LLM 请求可安全重放：它本身不产生外部副作用

state.phase == "tools_dispatched"
    -> 对 state.pending_calls 逐个判决：
       a) 没有 ledger            -> 全部按 AMBIGUOUS 处理
       b) ledger.reconcile_safe(call_id, tool_name, arguments):
          REPLAY_SKIP        -> 用 replay_result 直接补 tool 消息行 + yield ToolResultEvent
          FRESH              -> 重新执行该工具（账本证明它没跑过）
          AMBIGUOUS          -> 补一条 tool 消息行，content 取
                                agenticx.runtime.interrupted_closers.OUTCOME_UNKNOWN_CONTENT，
                                metadata.kind 取 KIND_OUTCOME_UNKNOWN；
                                并 yield ToolResultEvent(success=False)
          IDENTITY_CONFLICT  -> 抛 ToolCallIdentityError（不可恢复）
       补齐所有 pending 的 tool 行后，从 iterations + 1 继续主循环
```

**关于复用 `interrupted_closers` 的常量**：只 `from agenticx.runtime.interrupted_closers import OUTCOME_UNKNOWN_CONTENT, KIND_OUTCOME_UNKNOWN` 引用两个常量，**不调用** `close_interrupted_tool_calls()`（那是给 Studio 的整表扫描用的，这里我们已经精确知道哪些 pending）。`agenticx.runtime.interrupted_closers` 是纯函数模块、零 Studio 依赖，import 它不破坏 AC-M5。

为避免 `astream` 与 `aresume` 的主循环重复实现，把主循环抽成一个私有 async generator：

```python
    async def _loop(
        self,
        messages: List[Dict[str, Any]],
        *,
        start_iteration: int,
    ) -> AsyncIterator[AgentEvent]:
        """Shared FC loop body used by astream() and aresume()."""
```

`astream()` 变成「建 messages → 委托 `_loop(messages, start_iteration=0)`」，`aresume()` 变成「恢复 messages/补齐 pending → 委托 `_loop(messages, start_iteration=state.iteration)`」。这是**必要重构**，因为两份拷贝一定会漂移。

---

## 5. 验收标准（AC）

### AC-1：向后兼容（最高优先，先跑）

```bash
# 既有 ReActAgent 测试必须零修改通过
pytest tests/ -k "react_agent" -q
# SDK 零 Studio 耦合仍然成立
python -c "import sys, agenticx.agents; assert not [m for m in sys.modules if m.startswith('agenticx.studio')], sorted(m for m in sys.modules if m.startswith('agenticx.studio'))"
```

如果既有测试需要改才能过，说明破坏了兼容性 —— 回退重做，不要改测试。

### AC-2：`tests/test_reliability_run_state.py`

| 测试名 | 断言 |
|---|---|
| `test_roundtrip` | `RunState.from_dict(s.to_dict())` 与 `s` 等价（含 `pending_calls`） |
| `test_save_load_clear` | save → load 得到等价对象；clear 后 load 返回 `None` |
| `test_load_missing_returns_none` | 空目录 load → `None` |
| `test_future_schema_rejected` | 预置 `{"schema_version": 999}` → load 抛 `ValueError` |
| `test_save_failure_raises` | monkeypatch `atomic_write_json` 抛 `OSError` → `save` **抛出** |
| `test_atomic_no_partial_file` | monkeypatch 让写入中途抛异常后，原有文件内容保持上一次成功的版本（不是半截 JSON） |
| `test_path_traversal_rejected` | `RunStateStore("../evil", root=tmp_path)` 抛 `ValueError` |

### AC-3：`tests/test_react_agent_resume.py`

用一个 **确定性副作用计数器工具** 作为 oracle（测试内定义，不要引第三方）：

```python
class CounterTool(BaseTool):
    """Increments a shared counter; the count IS the side effect under test."""
    name = "bump"
    # _run(self, *, key: str) -> str:  self.calls.append(key); return f"count={len(self.calls)}"
```

| 测试名 | 场景 | 断言 |
|---|---|---|
| `test_no_store_behaves_identically` | 不传 `run_store` / `call_ledger` | 事件序列与改造前一致；`tmp_path` 下无任何文件产生 |
| `test_state_written_before_llm` | FakeLLM 在首次 `ainvoke` 抛异常 | `run_state.json` 存在且 `phase == "before_llm"` |
| `test_state_written_before_tools` | FakeLLM 返回 1 个 tool_call，工具执行时抛 `KeyboardInterrupt` | 状态 `phase == "tools_dispatched"` 且 `pending_calls` 长度 1、`canonical_key` 非空 |
| `test_resume_skips_completed_tool` | 手工构造 `phase="tools_dispatched"` + 账本里该 call 已 `completed(result="count=1")` | `aresume` 后 `CounterTool.calls` **长度不变**（未重复执行），且 messages 里出现 `content == "count=1"` 的 tool 行 |
| `test_resume_reruns_fresh_tool` | 账本里没有该 call（证明未派发成功） | `aresume` 后计数器 +1 |
| `test_resume_marks_ambiguous` | 账本里该 call 状态为 `dispatched`（无结果） | 计数器**不变**；messages 出现含 `OUTCOME_UNKNOWN_CONTENT` 的 tool 行，且该行 `metadata["kind"] == KIND_OUTCOME_UNKNOWN` |
| `test_resume_identity_conflict_raises` | 账本里同 call_id 记录了不同参数 | `aresume` 抛 `ToolCallIdentityError` |
| `test_resume_completed_returns_final` | `phase="completed"` | 立即 yield `FinalEvent(success=True)`，不再调用 LLM（FakeLLM 的调用计数为 0） |
| `test_final_clears_state` | 正常跑完一轮 | `run_store.load()` 返回 `None` |
| `test_stop_yields_interrupted_event` | `stop()` 后 | 事件流含 `InterruptedEvent(reason="user_stop")` 且 `messages` 非空；状态 `phase == "interrupted"` |
| `test_cancel_persists_then_reraises` | 在 `astream` 消费中 `task.cancel()` | `run_state.json` 的 `phase == "interrupted"`，且 `CancelledError` 仍向上抛出 |
| `test_stable_id_when_provider_omits_id` | FakeLLM 返回 `{"id": ""}` 的 tool_call | `ToolCallEvent.tool_call_id`、messages 里的 `tool_call_id`、账本里的 key **三者相同** 且非空 |
| `test_end_to_end_no_duplicate_side_effect` | 跑 2 个 tool_call → 在第 2 个结果落账后杀掉 → `aresume` | `CounterTool.calls` 总长度 == 2（不是 3、不是 4） |

`test_end_to_end_no_duplicate_side_effect` 是本 Subplan 的核心 AC，对应 master plan 的 AC-M3。

### AC-4：整体门槛

```bash
pytest tests/test_reliability_run_state.py tests/test_react_agent_resume.py tests/test_reliability_call_identity.py tests/test_reliability_ledger.py -q
git diff --name-only   # 应只含第 2 节 In scope 列出的文件
```

---

## 6. no-scope-creep 边界

改动文件白名单（`git status` 里不应出现白名单外的条目）：

```
agenticx/reliability/run_state.py          (新增)
agenticx/reliability/__init__.py           (仅追加导出)
agenticx/agents/react_agent_async.py       (修改)
agenticx/agents/agent_events.py            (仅新增 InterruptedEvent 与联合类型)
conclusions/agents_module_conclusion.md    (仅更新事件类型数量与新增能力描述)
tests/test_reliability_run_state.py        (新增)
tests/test_react_agent_resume.py           (新增)
```

明确禁止的顺手改动：
- 不要「顺便」给 `ReActAgent` 加重试、加并发上限、加超时。
- 不要动 `_execute_one_tool` 里的 offload 逻辑（`:195-209`）。
- 不要动 `run()` 的同步封装报错文案（`:394-401`）。
- 不要动 `agenticx/runtime/checkpoint.py` 去「统一两套 checkpoint」——两套并存是本阶段的有意设计，统一属于后续阶段。
