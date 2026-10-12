# Moat-01 · 产品主循环接入副作用账本（Effect Guard）

Planned-with: claude-opus-5.5
Suggested-Impl-Model: grok-4.7（若两轮仍无法让 AC 全绿，升级强推理档收口）
Plan-Id: 2026-10-12-moat-01-runtime-effect-guard
Plan-File: `.cursor/plans/2026-10-12-moat-01-runtime-effect-guard.plan.md`
Parent-Plan: `2026-10-12-governed-longrun-moat-master`

> **For implementer:** 独立 worktree，分支 `feat/moat-01-effect-guard`。不要 commit。严守 `no-scope-creep.mdc`：`agenticx/runtime/agent_runtime.py` 只允许在本文 §4.3 的两个锚点插入代码，不得移动、重排、重命名任何既有行。

## 1. 要解决的问题

Near 崩溃、被强退或关窗后，再打开会话点「继续」（或 HA 模式自动续跑），模型会重新规划。它可能把上一进程里**已经派发出去**的外部写（发消息、`git push`、MCP 写操作）用**一模一样的参数**再发一遍。

现在防重复只靠 `agenticx/runtime/interrupted_closers.py` 给模型写一句「结果未知，请自行核验」。这是概率性的。

可靠性内核早就有确定性的办法：`agenticx/reliability/call_ledger.py::CallLedger` 先 fsync 记录「已派发」，再执行，结束后记录结果。但它只接在 SDK `agenticx/agents/react_agent_async.py`（约 :398、:535、:714、:788）。产品主循环 `agenticx/runtime/agent_runtime.py` 一行没接（核验：`rg -n "CallLedger" agenticx/runtime/agent_runtime.py` 无结果）。

**为什么不能照抄 SDK 的接法：** SDK 续跑时 tool_call_id 不变，用 `ledger.reconcile(call_id, ...)` 即可。产品侧续跑后模型重新生成，**tool_call_id 是新的**，按 call_id 查永远是 FRESH。必须按「工具名 + 规范化参数」（`canonical_call_key`）查找**上一进程**留下的记录。

## 2. 行为规格（实现必须逐条满足）

只对「受保护的副作用调用」生效，定义见 §4.2 `is_guarded_call`。

| 情形 | 判定条件 | 行为 |
|---|---|---|
| A. 崩溃孤儿 | 账本中存在同 `canonical_key` 记录，`state == "dispatched"`，`dispatched_at < PROCESS_START_TS`，距今 ≤ 24h，`reconciled == False` | **不执行**。返回 §4.2 的 `ORPHAN_TEXT`，并把该记录标记 `reconciled`。同参数的**下一次**调用正常执行（用户核验后明确要求重做时可以做） |
| B. 中断前已完成 | 同 key 记录 `state == "completed"`、`result_payload is not None`、`dispatched_at < PROCESS_START_TS`、≤ 24h、未 reconciled，**且**当前会话在本进程启动扫描时被标记为 interrupted | **不执行**。返回 `REUSED_PREFIX + result_payload`，标记 reconciled |
| C. 其他 | — | 正常执行：执行前 `record_dispatch`，执行后 `record_result` / `record_failure` |
| D. 账本写失败（C 的 `record_dispatch` 抛异常） | `reliability_posture() == "strict"`（默认） | **不执行**，返回 `LEDGER_FAIL_TEXT` |
| D'. 同上 | posture 为 `legacy` | 照常执行，不记账，`logger.warning` |
| E. 用户中途停止 | 现有 stop 分支（`agent_runtime.py` 约 :7582-7599） | 不改。记录保持 `dispatched`，下次进程启动后自然落入情形 A |
| F. 开关关闭 | `AGX_EFFECT_GUARD=0` 或 config `runtime.effect_guard: false` | 完全不建 guard，行为与改动前逐字节一致 |

非受保护调用（读文件、`todo_write`、meta 工具等）**零行为变化、零磁盘写入**。

## 3. In scope / Out of scope

**In scope（只改这些）**

1. `agenticx/reliability/call_ledger.py`：`CallRecord` 加字段，`_apply_line` 认新 op，新增两个方法。
2. 新建 `agenticx/runtime/effect_guard.py`。
3. `agenticx/runtime/agent_runtime.py`：§4.3 的两个锚点 + `AgentRuntime` 上新增一个私有方法 `_get_effect_guard`。
4. `agenticx/studio/session_manager.py::scan_interrupted_sessions`：在 `return interrupted` 前加 3 行注册调用。
5. 新建 `tests/test_effect_guard.py`、`tests/test_call_ledger_prior_lookup.py`。

**Out of scope**

- 不改 `agenticx/reliability/replay_policy.py`、`call_identity.py`、SDK `react_agent_async.py`。
- 不改 `interrupted_closers.py`（它继续给模型写提示，与本 guard 叠加）。
- 不改 `agenticx/studio/server.py`。
- 不改 Desktop、不加 UI。
- 不做 local_write 守护（文件写重复执行通常幂等，且 `_persist_or_abort` 已守）。
- 不做跨机器 / Redis 共享账本。

## 4. 具体改动

### 4.1 `agenticx/reliability/call_ledger.py`

**(a) `CallRecord` 末尾新增字段**（放在 `arguments` 之后，保持 dataclass 默认值顺序合法）：

```python
    reconciled: bool = False
```

**(b) `_apply_line`**：在 `if op == "failure":` 分支之后、末尾 `return False` 之前插入：

```python
        if op == "reconciled":
            record.reconciled = True
            return True
```

（未知 op 仍返回 False，向后兼容；旧版本读到 `reconciled` 行会跳过，无害。）

**(c) 新增方法**（放在 `reconcile_safe` 之后）：

```python
    def find_prior_by_canonical_key(
        self,
        canonical_key: str,
        *,
        dispatched_before: float,
        max_age_seconds: float,
        now: float | None = None,
    ) -> CallRecord | None:
        """Latest unreconciled record with this key dispatched before a cutoff.

        Only ``dispatched`` and ``completed`` records qualify; ``failed`` ones
        never block a retry.
        """
        current = time.time() if now is None else now
        best: CallRecord | None = None
        with self._lock:
            for record in self._records.values():
                if record.canonical_key != canonical_key:
                    continue
                if record.reconciled:
                    continue
                if record.state not in ("dispatched", "completed"):
                    continue
                if record.dispatched_at >= dispatched_before:
                    continue
                if current - record.dispatched_at > max_age_seconds:
                    continue
                if best is None or record.dispatched_at > best.dispatched_at:
                    best = record
            return CallRecord(**best.__dict__) if best is not None else None

    def mark_reconciled(self, call_id: str, note: str = "") -> None:
        """Consume a prior record so the same call is not intercepted twice."""
        self._append(
            {
                "v": 1,
                "op": "reconciled",
                "ts": time.time(),
                "call_id": call_id,
                "note": note[:200],
            }
        )
        with self._lock:
            record = self._records.get(call_id)
            if record is not None:
                record.reconciled = True
```

### 4.2 新建 `agenticx/runtime/effect_guard.py`

完整接口（实现可调整内部细节，**名字、签名、常量文本不得改**，测试按这些断言）：

```python
#!/usr/bin/env python3
"""Dispatch-time side-effect guard for the product AgentRuntime.

Author: Damon Li
"""

from __future__ import annotations

import logging
import os
import threading
import time
import uuid
from dataclasses import dataclass
from typing import Any, Iterable, Literal

logger = logging.getLogger(__name__)

PROCESS_START_TS: float = time.time()
PRIOR_MAX_AGE_SECONDS: float = 24 * 3600

_GUARDED_UNKNOWN_TOOLS = frozenset({"bash_exec", "bash_bg_start", "mcp_call"})
_GUARDED_UNKNOWN_PREFIXES = ("computer_", "near_browser_click", "near_browser_type")
_RUNTIME_ARG_KEYS = frozenset({"__tool_call_id", "__agent_id"})

ORPHAN_TEXT = (
    "未执行：同一操作在上次运行中已发出，但应用在拿到结果前退出，结果未知。"
    "请先用只读方式核验它是否已经生效（例如查看消息、远端仓库或目标系统）。"
    "如果确认没有生效、且用户仍要执行，再调用一次即可，下一次会正常执行。"
)
REUSED_PREFIX = "[已复用中断前完成的结果，本次未重复执行]\n"
LEDGER_FAIL_TEXT = (
    "未执行：执行外部操作前写入副作用账本失败，为避免崩溃后重复执行已跳过。"
    "请检查磁盘空间或 ~/.agenticx/sessions 权限后重试。"
)

_interrupted_lock = threading.Lock()
_INTERRUPTED_SESSIONS: set[str] = set()


def register_interrupted_sessions(session_ids: Iterable[str]) -> None: ...
def is_interrupted_at_startup(session_id: str) -> bool: ...
def effect_guard_enabled() -> bool: ...
def is_guarded_call(tool_name: str, arguments: dict[str, Any]) -> bool: ...
def resolve_session_id(session: Any) -> str: ...


@dataclass(frozen=True)
class GuardDecision:
    action: Literal["dispatch", "prefilled"]
    text: str | None = None
    ledger_call_id: str | None = None


class EffectGuard:
    def __init__(self, session_id: str, *, root: str | None = None) -> None: ...
    def before_dispatch(
        self, *, tool_call_id: str, tool_name: str, arguments: dict[str, Any]
    ) -> GuardDecision: ...
    def after_result(self, ledger_call_id: str, result: str, *, is_error: bool) -> None: ...
```

实现要点：

- `effect_guard_enabled()`：环境变量 `AGX_EFFECT_GUARD` 取 `0/false/no/off` → False，`1/true/yes/on` → True；否则读 `ConfigManager.get_value("runtime.effect_guard")`（import 放函数内，异常视为未配置）；未配置默认 **True**。
- `is_guarded_call`：调用 `agenticx.runtime.replay_ledger.effects.classify_tool_effect(tool_name, arguments)`。返回 `"external_write"` → True；返回 `"unknown"` 且（`tool_name in _GUARDED_UNKNOWN_TOOLS` 或 `tool_name.startswith(_GUARDED_UNKNOWN_PREFIXES)`）→ True；其余 False。**不要**把所有 `unknown` 都纳入（`classify_tool_effect` 对未登记工具一律返回 `unknown`，见 `effects.py` 末行，全纳入会误拦 meta 工具）。
- `resolve_session_id`：与 `agent_runtime.py:268-273` 同一顺序：`_session_id` → `_owner_session_id` → `session_id`，`str().strip()`，空串返回 `""`。
- `EffectGuard.__init__`：`self._ledger = CallLedger(session_id, root=root)`（import 自 `agenticx.reliability.call_ledger`）。构造失败（`LedgerCorruptError` 等）由调用方 `_get_effect_guard` 捕获并返回 None。
- `before_dispatch`：
  1. `if not is_guarded_call(tool_name, arguments): return GuardDecision("dispatch")`（`ledger_call_id=None`，调用方据此不记录结果）。
  2. `clean = {k: v for k, v in arguments.items() if k not in _RUNTIME_ARG_KEYS}`；`key = canonical_call_key(tool_name, clean)`。
  3. `prior = self._ledger.find_prior_by_canonical_key(key, dispatched_before=PROCESS_START_TS, max_age_seconds=PRIOR_MAX_AGE_SECONDS)`。
  4. 情形 A：`prior.state == "dispatched"` → `mark_reconciled(prior.call_id, "orphan_intercepted")`，返回 `GuardDecision("prefilled", text=ORPHAN_TEXT)`。
  5. 情形 B：`prior.state == "completed" and prior.result_payload is not None and is_interrupted_at_startup(self.session_id)` → `mark_reconciled(prior.call_id, "completed_reused")`，返回 `GuardDecision("prefilled", text=REUSED_PREFIX + prior.result_payload)`。
  6. 情形 C：`ledger_call_id = f"{tool_call_id or 'call'}:{uuid.uuid4().hex[:8]}"`（**必须**加随机后缀：部分 provider 会在不同轮次复用 `call_0` 这类 id，直接用会覆盖历史记录）。`self._ledger.record_dispatch(ledger_call_id, tool_name, clean, replay_safety=classify_tool_effect(tool_name, arguments))`，返回 `GuardDecision("dispatch", ledger_call_id=ledger_call_id)`。
  7. 第 6 步 `record_dispatch` 抛异常：`from agenticx.runtime.harden_flags import reliability_posture`；`strict` → 返回 `GuardDecision("prefilled", text=LEDGER_FAIL_TEXT)`；否则 `logger.warning(...)` 并返回 `GuardDecision("dispatch")`。
  8. 第 3–5 步 `mark_reconciled` 抛异常：按第 7 步同样的 posture 规则处理（strict 返回 `LEDGER_FAIL_TEXT`）。
- `after_result`：`is_error` 为 True 调 `record_failure(ledger_call_id, result[:2000])`，否则 `record_result(ledger_call_id, result)`。任何异常只 `logger.warning`，**绝不抛出**。

### 4.3 `agenticx/runtime/agent_runtime.py`

**新增方法**（放在 `_persist_or_abort` 方法定义之前，约 :3683；只新增，不改 `_persist_or_abort`）：

```python
    def _get_effect_guard(self, session: Any) -> Any:
        """Per-session EffectGuard; None when disabled or unavailable."""
        from agenticx.runtime.effect_guard import (
            EffectGuard,
            effect_guard_enabled,
            resolve_session_id,
        )

        if not effect_guard_enabled():
            return None
        sid = resolve_session_id(session)
        if not sid:
            return None
        cache = self.__dict__.setdefault("_effect_guards", {})
        guard = cache.get(sid)
        if guard is None:
            try:
                guard = EffectGuard(sid)
            except Exception:
                logger.warning("effect guard unavailable session=%s", sid, exc_info=True)
                return None
            cache[sid] = guard
        return guard
```

（用 `self.__dict__.setdefault` 是为了不改 `__init__`。）

**锚点 1：派发前。** 现有代码（约 :7490-7574）：

```python
                ok, detail = self._persist_or_abort(f"tool:{tool_name}")
                if not ok:
                    ...
                    continue
                effective_tm = self.team_manager or getattr(session, "_team_manager", None)
                meta_only_names, meta_dispatch = _resolve_meta_tool_dispatchers()
                if tool_name in meta_only_names:
                    if effective_tm is None:
                        dispatch_task = asyncio.create_task(
                            asyncio.sleep(0, result=f"ERROR: meta tool '{tool_name}' requires team manager")
                        )
                    else:
                        dispatch_task = asyncio.create_task(meta_dispatch(...))
                else:
                    dispatch_task = asyncio.create_task(dispatch_tool_async(...))
```

改成（**只**在 `meta_only_names, meta_dispatch = ...` 那行之后插入 guard 计算，并把 `if tool_name in meta_only_names:` 改为 `elif`，前面加一个新的 `if` 分支；`meta_dispatch(...)` 与 `dispatch_tool_async(...)` 的参数一字不改）：

```python
                effective_tm = self.team_manager or getattr(session, "_team_manager", None)
                meta_only_names, meta_dispatch = _resolve_meta_tool_dispatchers()
                _effect_guard = self._get_effect_guard(session)
                _effect_ledger_id: Optional[str] = None
                _effect_prefilled: Optional[str] = None
                if _effect_guard is not None and tool_name not in meta_only_names:
                    _effect_decision = _effect_guard.before_dispatch(
                        tool_call_id=tool_call_id,
                        tool_name=tool_name,
                        arguments=arguments,
                    )
                    if _effect_decision.action == "prefilled":
                        _effect_prefilled = _effect_decision.text
                    else:
                        _effect_ledger_id = _effect_decision.ledger_call_id
                if _effect_prefilled is not None:
                    dispatch_task = asyncio.create_task(asyncio.sleep(0, result=_effect_prefilled))
                elif tool_name in meta_only_names:
                    ...  # unchanged
                else:
                    ...  # unchanged
```

注意：传给 `before_dispatch` 的是 `arguments`（模型原始参数），**不是** `dispatch_arguments`。`Optional` 已在该文件顶部导入（实施前 `rg -n "^from typing" agenticx/runtime/agent_runtime.py` 确认；若未导入 `Optional`，改用 `str | None` 注解，不要改 import 区）。

预填结果走的是现有 `dispatch_task` 管线，所以 TOOL_RESULT 事件、`messages` / `agent_messages` / `chat_history` 写入、结果预算全部复用，不用另写一套。

**锚点 2：拿到结果后。** 现有代码（约 :7630-7633）：

```python
                try:
                    result = await dispatch_task
                except Exception as exc:
                    result = f"ERROR: tool execution failed: {exc}"
```

在这四行**之后**、`if tool_name == "query_subagent_status":` **之前**插入：

```python
                if _effect_guard is not None and _effect_ledger_id:
                    _effect_text = str(result)
                    _effect_guard.after_result(
                        _effect_ledger_id,
                        _effect_text,
                        is_error=_effect_text.startswith(("ERROR:", "CANCELLED:")),
                    )
```

stop 分支（约 :7582-7599，`cancel_turn_scoped_dispatch` 后 `return`）不加任何代码：被中途取消的调用保持 `dispatched`，正是情形 A 要捕获的状态。

### 4.4 `agenticx/studio/session_manager.py::scan_interrupted_sessions`（约 :1066-1094）

在函数末尾 `return interrupted` 之前插入：

```python
        try:
            from agenticx.runtime.effect_guard import register_interrupted_sessions

            register_interrupted_sessions(interrupted)
        except Exception:
            _log.debug("effect guard interrupted registration failed", exc_info=True)
```

（该函数在 `agenticx/studio/server.py:1273` 启动时必调，且 `resume_interrupted_sessions` 内会再调一次；`register_interrupted_sessions` 只做集合并集，重复调用无害。）

## 5. 验收标准（AC）与测试

### `tests/test_call_ledger_prior_lookup.py`

| AC | 断言 |
|---|---|
| AC-1 | 同 key 两条记录（dispatched_at=100、200），`dispatched_before=300` → 返回 200 那条 |
| AC-2 | `dispatched_before=150` → 返回 100 那条；`=50` → None |
| AC-3 | `failed` 记录不返回；`reconciled` 记录不返回 |
| AC-4 | `now - dispatched_at > max_age_seconds` → None |
| AC-5 | `mark_reconciled` 后用新 `CallLedger(sid, root=tmp)` 重新加载，该记录 `reconciled is True`（证明 JSONL 持久化） |
| AC-6 | 写一个只含旧格式行（无 `reconciled` 字段、无 `reconciled` op）的文件，能正常加载，`reconciled` 默认 False |

### `tests/test_effect_guard.py`

用 `tmp_path` 作为 ledger root（`EffectGuard(sid, root=str(tmp_path))`），用 `monkeypatch.setattr(effect_guard, "PROCESS_START_TS", ...)` 模拟进程边界。

| AC | 场景 | 断言 |
|---|---|---|
| AC-7 | `file_read` / `todo_write` | `action == "dispatch"` 且 `ledger_call_id is None`；`tmp_path/<sid>/call_ledger.jsonl` 不存在 |
| AC-8 | 情形 C：`bash_exec` `{"command": "git push origin main"}` | 返回带 `ledger_call_id`；`after_result` 后账本里该记录 `state == "completed"` |
| AC-9 | 情形 A：先用 guard1 `before_dispatch` 记一条 dispatched 不调用 after_result；把 `PROCESS_START_TS` 设为当前时间 +1；新建 guard2 同参数调用 | 第一次 `action == "prefilled"` 且 `text == ORPHAN_TEXT`；第二次 `action == "dispatch"` |
| AC-10 | 情形 B：guard1 完成一条（result="sent ok"）；`register_interrupted_sessions([sid])`；推进 `PROCESS_START_TS` | guard2 返回 `REUSED_PREFIX + "sent ok"`；第二次正常 dispatch |
| AC-11 | 情形 B 但会话**未**注册为 interrupted | 返回 `dispatch`（不复用） |
| AC-12 | 参数里带 `__tool_call_id` / `__agent_id`，与不带时 | `canonical_key` 相同（runtime 键被剔除） |
| AC-13 | `mcp_call`、`near_browser_click` 受保护；`query_subagent_status`、`delegate_to_avatar` 不受保护 | `is_guarded_call` 分别 True / False |
| AC-14 | 情形 D：monkeypatch `CallLedger.record_dispatch` 抛 `OSError`；posture=strict | `text == LEDGER_FAIL_TEXT`；posture=legacy（`AGX_RELIABILITY_POSTURE=legacy`）→ `dispatch` 且无 ledger id |
| AC-15 | `AGX_EFFECT_GUARD=0` | `effect_guard_enabled() is False` |
| AC-16 | 不同 provider 复用同一个 `tool_call_id="call_0"` 连发两次不同参数 | 两条记录都在账本里（`ledger_call_id` 不同） |

### 回归

```bash
pytest tests/test_effect_guard.py tests/test_call_ledger_prior_lookup.py -q
pytest tests/test_reliability_ledger.py tests/test_reliability_replay_policy.py tests/test_reliability_bench.py tests/test_react_agent_resume.py tests/test_ha_checkpoint_resume.py -q
pytest tests -q -k "agent_runtime or runtime_tool or interrupted" 
python -c "import sys, agenticx.agents; assert not [m for m in sys.modules if m.startswith('agenticx.studio')]"
```

最后一条保证 SDK 依然不依赖 Studio（`effect_guard.py` 只被 `agent_runtime.py` 引用，不被 `agenticx.agents` 引用）。

### 手工冒烟（实施者执行并在汇报里贴结果）

1. `agx serve --host 127.0.0.1 --port 8765` 启动；建会话，让模型执行 `bash_exec` `echo hi > /tmp/agx_guard_smoke && curl -s https://example.com -o /dev/null`（会被归为受保护）。
2. 执行中 `kill -9` serve 进程；重启；在同会话发「继续」。
3. 预期：若模型重发同一命令，第一次工具结果为 `ORPHAN_TEXT`；`~/.agenticx/sessions/<sid>/call_ledger.jsonl` 出现 `op":"reconciled"` 行。

## 6. 风险与回退

- 误拦合法重复：只在**进程边界之前**的记录上触发，且每条只拦一次。用户核验后再说「重做」即可执行。
- 磁盘写放大：只对受保护调用 fsync，频率与外部写次数相同。
- 一键回退：`AGX_EFFECT_GUARD=0`。
