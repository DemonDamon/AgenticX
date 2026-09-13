---
name: sdk-reliability-01-call-identity
overview: 新建 agenticx/reliability/ 可靠性内核的第一块基石——工具调用的规范身份与幂等账本。当前 AgenticX 全仓没有任何「这次工具调用是不是上次那一次」的概念（rg fingerprint 的命中全是前缀缓存/入库缓存/循环检测的无关指纹），导致崩溃恢复只能靠 interrupted_closers 塞一句「结果未知，你自己去核验」把幂等判断外包给 LLM。本 Subplan 交付 canonical_call_key() 参数规范化、CallLedger JSONL 账本、以及 reconcile() 四态判决（FRESH / REPLAY_SKIP / AMBIGUOUS / IDENTITY_CONFLICT），为 02（SDK 续跑）与 03（重放策略）提供确定性依据。纯新增模块，不改任何既有文件。
todos:
  - id: t1
    content: 新建 agenticx/reliability/ 包骨架与 errors.py
    status: pending
  - id: t2
    content: 实现 call_identity.py 的 canonical_call_key()
    status: pending
  - id: t3
    content: 实现 call_ledger.py 的 CallRecord / CallLedger（JSONL 持久化）
    status: pending
  - id: t4
    content: 实现 reconcile() 四态判决
    status: pending
  - id: t5
    content: tests/test_reliability_call_identity.py + tests/test_reliability_ledger.py 全绿
    status: pending
isProject: false
---

# Subplan 01：Tool-call 规范身份与幂等账本

**Plan-Id**: `2026-09-12-sdk-reliability-01-call-identity`
**Plan-File**: `.cursor/plans/2026-09-12-sdk-reliability-01-call-identity.plan.md`
**Master**: `2026-09-12-sdk-reliability-kernel-master`
**Planned-with**: Claude Opus 5
**Suggested-Impl-Model**: Grok 4.6
**Made-with**: Damon Li

---

## 1. 要解决什么（根因与证据）

**现状事实（已核对，不需回看对话）：**

1. 全仓 `rg 'fingerprint' agenticx/` 的命中里，没有一个是工具调用身份：
   - `agenticx/runtime/prompt_cache_policy.py` → LLM 前缀缓存指纹
   - `agenticx/studio/kb/ingest_cache.py` → 知识库入库去重指纹
   - `agenticx/runtime/loop_detector.py::fingerprint_from_result` → 循环检测的**结果**指纹（用于判断「有没有进展」，不是身份）
2. `agenticx/runtime/interrupted_closers.py:18-22` 的 `OUTCOME_UNKNOWN_CONTENT` 是当前唯一的崩溃恢复手段，内容是一段自然语言，要求 LLM「先用只读方式核验外部状态」。**幂等判断被外包给模型的自觉性。**
3. `agenticx/agents/react_agent_async.py` 里 tool_call id 的取法本身就不自洽：
   - `:263` 发事件时用 `tc_id = str(tc.get("id", "") or f"call_{name}_{iterations}")`（有兜底）
   - `:275` 真执行时用 `str(tc.get("id", "") or "")`（无兜底，可能是空串）
   - `:288` 写回 tool 消息时又用 `str(tc.get("id", "") or "")`
   
   同一次调用在事件流里的 id 和在 messages 里的 id **可能不同**。这使得任何基于 id 的账本都不可靠，必须在 02 里统一（本 Subplan 只提供 `stable_call_id()` 工具函数，实际替换在 02 做）。

**对标上游**：`openai/openai-agents-python@fbd2dbc` 用 `call_id + payload fingerprint` 作为调用身份，完全相同的调用可跳过重放，同 id 但参数变了直接抛 `ModelBehaviorError`。我们要在语义上对齐并且更严格（AMBIGUOUS 单独成态，fail-closed）。

---

## 2. In scope / Out of scope

### In scope

新增以下文件，**全部是新文件，不修改任何既有文件**：

- `agenticx/reliability/__init__.py`
- `agenticx/reliability/errors.py`
- `agenticx/reliability/call_identity.py`
- `agenticx/reliability/call_ledger.py`
- `tests/test_reliability_call_identity.py`
- `tests/test_reliability_ledger.py`

### Out of scope

- **不改** `agenticx/agents/react_agent_async.py`（接入在 Subplan 02）。
- **不改** `agenticx/runtime/interrupted_closers.py`（保持纯函数与现有文案）。
- **不改** `agenticx/runtime/checkpoint.py`。
- **不做**分布式锁 / 跨主机 CAS。
- **不引入任何新的第三方依赖**（只用标准库 `json` / `hashlib` / `pathlib` / `dataclasses` / `threading`）。
- 不做 CLI 入口、不做 REST 路由。

---

## 3. 文件 1：`agenticx/reliability/errors.py`

```python
#!/usr/bin/env python3
"""Reliability kernel exceptions.

Author: Damon Li
"""

from __future__ import annotations


class ReliabilityError(Exception):
    """Base class for reliability-kernel failures."""


class ToolCallIdentityError(ReliabilityError):
    """Same ``call_id`` reappeared with a different canonical payload.

    This is never recoverable by retrying: the model either fabricated an id
    or the transport corrupted the call. Fail loudly instead of guessing which
    payload was intended.
    """

    def __init__(
        self,
        call_id: str,
        *,
        recorded_key: str,
        incoming_key: str,
        changed_fields: tuple[str, ...] = (),
    ) -> None:
        self.call_id = call_id
        self.recorded_key = recorded_key
        self.incoming_key = incoming_key
        self.changed_fields = changed_fields
        fields = ", ".join(changed_fields) if changed_fields else "<unknown>"
        super().__init__(
            f"tool call id {call_id!r} reused with different arguments: "
            f"recorded key {recorded_key[:16]}, incoming key {incoming_key[:16]}, "
            f"changed fields: {fields}"
        )


class LedgerCorruptError(ReliabilityError):
    """Ledger file exists but cannot be parsed into a usable state."""
```

**注意 AC-M4 的要求**：异常消息必须含 `call_id`、两个 key 的前 16 位、变化的字段名。上面的实现已满足，不要简化。

---

## 4. 文件 2：`agenticx/reliability/call_identity.py`

### 4.1 职责

把 `(tool_name, arguments)` 规范化成一个稳定字符串键。**同一次逻辑调用在任何机器、任何 Python 版本、任何 dict 插入顺序下必须得到同一个键。**

### 4.2 精确要求（逐条实现，不要"按需推断"）

| 规则 | 要求 | 理由 |
|---|---|---|
| dict 键序 | `sort_keys=True` | 模型两次生成的 JSON 键序可能不同，但是同一次调用 |
| 分隔符 | `separators=(",", ":")` | 消除空白差异 |
| 非 ASCII | `ensure_ascii=False` | 中文参数不应因转义方式不同而变键 |
| `float` | `repr(v)` 归一；`-0.0` 归一为 `0.0` | `1.0` 与 `1` 必须**不同**键（类型是语义的一部分），但 `-0.0`/`0.0` 相同 |
| `NaN` / `Inf` | 抛 `ValueError` | 不可比较的值不能当身份 |
| 嵌套结构 | 递归规范化 dict / list / tuple | tuple 归一为 list（JSON 无 tuple） |
| set / frozenset | 排序后归一为 list；元素不可排序时按 `repr` 排序 | 保证确定性 |
| 未知类型 | 抛 `TypeError`，消息含类型名与路径 | 静默 `str()` 会让不同对象撞键 |
| 摘要 | `hashlib.sha256(canonical_json.encode("utf-8")).hexdigest()` | 定长、可日志化 |
| 键格式 | `f"{tool_name}:{sha256_hex}"` | 工具名进键，防止不同工具同参数撞键 |

### 4.3 公开 API

```python
def canonical_payload(arguments: Any) -> str:
    """Return the canonical JSON text for ``arguments``.

    Raises ValueError on NaN/Inf, TypeError on unsupported types.
    """


def canonical_call_key(tool_name: str, arguments: Any) -> str:
    """Return ``"<tool_name>:<sha256-of-canonical-payload>"``."""


def diff_canonical_fields(a: Any, b: Any) -> tuple[str, ...]:
    """Top-level + dotted nested field names whose canonical form differs.

    Used only to make ToolCallIdentityError messages actionable. Best effort:
    if either side is not a mapping, returns ``("<root>",)``.
    """


def stable_call_id(
    raw_id: Any,
    *,
    tool_name: str,
    iteration: int,
    position: int,
) -> str:
    """Normalize a provider tool_call id into a non-empty stable id.

    Some providers emit empty or missing ids. Falls back to a deterministic
    synthetic id so ledger lookups never key on the empty string. The fallback
    is deterministic across a resume of the same run, which is why it uses
    (tool_name, iteration, position) rather than uuid4.

    Fallback format: ``"synth-{tool_name}-{iteration}-{position}"``.
    """
```

### 4.4 实现要点（伪代码）

```python
def _norm(value, path):
    if value is None or isinstance(value, (str, bool)):
        return value
    if isinstance(value, int) and not isinstance(value, bool):
        return value
    if isinstance(value, float):
        if value != value or value in (float("inf"), float("-inf")):
            raise ValueError(f"non-finite float at {path}")
        return 0.0 if value == 0.0 else value
    if isinstance(value, dict):
        return {str(k): _norm(v, f"{path}.{k}") for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_norm(v, f"{path}[{i}]") for i, v in enumerate(value)]
    if isinstance(value, (set, frozenset)):
        items = [_norm(v, f"{path}{{}}") for v in value]
        try:
            return sorted(items)
        except TypeError:
            return sorted(items, key=repr)
    raise TypeError(f"unsupported type {type(value).__name__} at {path}")
```

`bool` 必须在 `int` 之前判定（Python 中 `isinstance(True, int)` 为真）。

---

## 5. 文件 3：`agenticx/reliability/call_ledger.py`

### 5.1 数据模型

```python
CallState = Literal["dispatched", "completed", "failed"]


@dataclass
class CallRecord:
    call_id: str
    canonical_key: str
    tool_name: str
    state: CallState
    dispatched_at: float
    completed_at: float | None = None
    result_digest: str | None = None      # sha256 of result text, for audit
    result_payload: str | None = None     # stored result, enables REPLAY_SKIP
    error: str | None = None
    replay_safety: str = "unknown"        # consumed by Subplan 03
```

`result_payload` 是 `REPLAY_SKIP` 能返回真实结果的前提。为避免账本无限膨胀，超过 `max_inline_result_bytes`（默认 `65536`）时只存 `result_digest`，`result_payload=None`，此时 `reconcile` 对该记录返回 `AMBIGUOUS` 而不是 `REPLAY_SKIP`（**宁可多问一次，不要凭摘要伪造结果**）。

### 5.2 判决枚举

```python
class Verdict(str, Enum):
    FRESH = "fresh"                        # 从未见过，正常执行
    REPLAY_SKIP = "replay_skip"            # 同 id 同 key 且已完成且结果可复用 → 直接返回存档结果
    AMBIGUOUS = "ambiguous"                # 同 id 同 key 但状态为 dispatched（或结果未内联）→ 外部状态未知
    IDENTITY_CONFLICT = "identity_conflict"  # 同 id 不同 key → 抛 ToolCallIdentityError
```

```python
@dataclass
class Reconciliation:
    verdict: Verdict
    record: CallRecord | None = None
    replay_result: str | None = None   # 仅 REPLAY_SKIP 时非 None
```

### 5.3 `CallLedger` 接口

```python
class CallLedger:
    def __init__(
        self,
        session_id: str,
        *,
        root: str | Path | None = None,
        max_inline_result_bytes: int = 65536,
    ) -> None:
        """Per-session append-only ledger.

        Default root is ``~/.agenticx/sessions/<session_id>/`` resolved via
        ``agenticx.utils.agx_home.agx_home()``; the ledger file is
        ``call_ledger.jsonl``. ``root`` overrides the parent directory (tests
        pass tmp_path).
        """

    # --- write path -------------------------------------------------
    def record_dispatch(self, call_id: str, tool_name: str, arguments: Any,
                        *, replay_safety: str = "unknown") -> CallRecord: ...
    def record_result(self, call_id: str, result: str, *, success: bool = True) -> None: ...
    def record_failure(self, call_id: str, error: str) -> None: ...

    # --- read path --------------------------------------------------
    def lookup(self, call_id: str) -> CallRecord | None: ...
    def reconcile(self, call_id: str, tool_name: str, arguments: Any) -> Reconciliation: ...
    def pending_call_ids(self) -> tuple[str, ...]:
        """call_ids whose state is still 'dispatched' (crash-window set)."""

    # --- lifecycle --------------------------------------------------
    @classmethod
    def load(cls, session_id: str, *, root=None) -> "CallLedger":
        """Rebuild in-memory index by replaying the JSONL file."""
    def close(self) -> None: ...
```

### 5.4 持久化契约（照做，不要发挥）

- 文件：`<root>/<session_id>/call_ledger.jsonl`，**append-only**，一行一个 JSON 对象。
- 每行结构：`{"v": 1, "op": "dispatch"|"result"|"failure", "ts": <float>, ...CallRecord 字段子集}`。
  - `"v"` 是 schema 版本，读取时遇到 `v > 1` 记 warning 并跳过该行（向前兼容）。
- **写入必须在返回前 flush + fsync**：
  ```python
  self._fh.write(line + "\n")
  self._fh.flush()
  os.fsync(self._fh.fileno())
  ```
  不 fsync 就等于没写——本模块的全部价值是「崩溃后账本还在」。这是 fail-closed 姿态，不要为了性能去掉。
- 写失败必须**抛出**，不得像 `agenticx/runtime/checkpoint.py:73-88` 那样 `logger.warning` 后吞掉。账本写不进去 = 幂等保证失效 = 必须让调用方知道。
- 单行解析失败：记 warning 跳过；如果**整个文件**一行都解析不出且文件非空，抛 `LedgerCorruptError`。
- 目录不存在时 `mkdir(parents=True, exist_ok=True)`。
- `session_id` 做路径穿越防护：拒绝含 `/`、`\`、`..` 的值（参照 `agenticx/core/offload/file_offloader.py` 已有的防护写法）。
- 线程安全：用一把 `threading.Lock` 保护写路径与内存索引。不需要跨进程锁（per-session 单写者；如需多进程，调用方自行用已有的 `agenticx.sessions.SessionWriteLock`，本模块不重复实现）。

### 5.5 `reconcile()` 判决逻辑（精确顺序）

```
key = canonical_call_key(tool_name, arguments)
rec = lookup(call_id)

1. rec is None                          -> FRESH
2. rec.canonical_key != key             -> raise ToolCallIdentityError(
                                              call_id,
                                              recorded_key=rec.canonical_key,
                                              incoming_key=key,
                                              changed_fields=diff_canonical_fields(...))
                                           （调用方若捕获，视为 IDENTITY_CONFLICT）
3. rec.state == "completed" and rec.result_payload is not None
                                        -> REPLAY_SKIP (replay_result=rec.result_payload)
4. rec.state == "failed"                -> FRESH   # 失败可以重试
5. otherwise (dispatched，或 completed 但结果未内联)
                                        -> AMBIGUOUS
```

第 2 步**抛异常**而不是返回 `IDENTITY_CONFLICT`，因为这是编程/协议错误而非可选路径。`Verdict.IDENTITY_CONFLICT` 枚举值保留给需要「不抛异常地分类」的调用方（Subplan 04 的基准会用到），并提供 `reconcile_safe()` 变体返回该枚举而不抛：

```python
def reconcile_safe(self, call_id, tool_name, arguments) -> Reconciliation:
    """Like reconcile() but returns IDENTITY_CONFLICT instead of raising."""
```

### 5.6 `__init__.py` 导出

```python
from agenticx.reliability.call_identity import (
    canonical_call_key, canonical_payload, diff_canonical_fields, stable_call_id,
)
from agenticx.reliability.call_ledger import (
    CallLedger, CallRecord, CallState, Reconciliation, Verdict,
)
from agenticx.reliability.errors import (
    LedgerCorruptError, ReliabilityError, ToolCallIdentityError,
)

__all__ = [...]  # 列全上面所有名字
```

**`agenticx/reliability/__init__.py` 严禁 import `agenticx.studio` / `agenticx.cli` 下的任何东西**，否则会破坏 SDK 侧的零产品耦合（见 master plan 的 AC-M5）。

---

## 6. 验收标准（AC）

### AC-1：规范化键的稳定性

`tests/test_reliability_call_identity.py` 必须包含：

| 测试名 | 断言 |
|---|---|
| `test_key_stable_across_dict_order` | `canonical_call_key("t", {"a":1,"b":2}) == canonical_call_key("t", {"b":2,"a":1})` |
| `test_key_differs_by_tool_name` | 同参数、不同 tool_name → 键不同 |
| `test_int_and_float_differ` | `{"n": 1}` 与 `{"n": 1.0}` → 键**不同** |
| `test_negative_zero_normalized` | `{"n": -0.0}` 与 `{"n": 0.0}` → 键**相同** |
| `test_nan_rejected` | `canonical_payload({"n": float("nan")})` 抛 `ValueError` |
| `test_inf_rejected` | `float("inf")` 抛 `ValueError` |
| `test_unsupported_type_rejected` | 传入 `object()` 抛 `TypeError`，消息含 `"object"` |
| `test_bool_not_int` | `{"f": True}` 与 `{"f": 1}` → 键**不同** |
| `test_nested_normalized` | `{"a": {"x": [1, {"z": 2}]}}` 两种键序写法 → 键相同 |
| `test_tuple_equals_list` | `{"a": (1, 2)}` 与 `{"a": [1, 2]}` → 键**相同** |
| `test_unicode_stable` | `{"名": "值"}` 可算键且不含转义序列（断言 `"名" in canonical_payload(...)`） |
| `test_stable_call_id_fallback_deterministic` | 同 `(tool_name, iteration, position)` 两次调用 → 同 id；`raw_id` 非空时原样返回 |
| `test_diff_fields_reports_changed_key` | `diff_canonical_fields({"a":1,"b":2}, {"a":1,"b":3}) == ("b",)` |

### AC-2：账本行为

`tests/test_reliability_ledger.py`（全部用 `tmp_path` 作 `root`）：

| 测试名 | 断言 |
|---|---|
| `test_fresh_when_unseen` | `reconcile` → `Verdict.FRESH` |
| `test_replay_skip_returns_stored_result` | dispatch → result("OK") → `reconcile` 返回 `REPLAY_SKIP` 且 `replay_result == "OK"` |
| `test_ambiguous_when_dispatched_only` | dispatch 后不 record_result → `AMBIGUOUS` |
| `test_failed_becomes_fresh` | `record_failure` 后 → `FRESH` |
| `test_identity_conflict_raises` | 同 call_id 不同参数 → 抛 `ToolCallIdentityError`；异常 `str()` 含 call_id 且含 `"b"`（变化字段） |
| `test_reconcile_safe_does_not_raise` | 同上场景走 `reconcile_safe` → `Verdict.IDENTITY_CONFLICT` |
| `test_large_result_not_inlined` | `max_inline_result_bytes=8`，写入 `"x"*100` → `reconcile` 得 `AMBIGUOUS`，且 `record.result_digest` 非空、`result_payload is None` |
| `test_survives_reload` | 写 3 条后 `CallLedger.load(...)` 重建，`lookup` 全部命中、`reconcile` 判决与重启前一致 |
| `test_pending_call_ids` | 2 个 dispatched + 1 个 completed → `pending_call_ids()` 只含前两个 |
| `test_write_failure_raises` | 用 `monkeypatch` 让 `os.fsync` 抛 `OSError` → `record_dispatch` **抛出**（不得静默） |
| `test_corrupt_file_raises` | 预置一个全是 `"not json"` 的非空文件 → `CallLedger.load` 抛 `LedgerCorruptError` |
| `test_partial_corrupt_line_skipped` | 3 行中第 2 行坏 → `load` 成功，另外 2 条可用 |
| `test_unknown_schema_version_skipped` | 预置 `{"v": 99, ...}` 行 → 跳过且不抛 |
| `test_path_traversal_rejected` | `CallLedger("../evil", root=tmp_path)` 抛 `ValueError` |
| `test_jsonl_is_append_only` | 记录 3 次后文件行数 == 3；再 record_result 一次 → 4 行（不是原地改写） |

### AC-3：零耦合与整体门槛

```bash
# 1) 测试全绿
pytest tests/test_reliability_call_identity.py tests/test_reliability_ledger.py -q

# 2) 不引入 studio 依赖
python -c "import sys, agenticx.reliability; assert not [m for m in sys.modules if m.startswith('agenticx.studio')], sorted(m for m in sys.modules if m.startswith('agenticx.studio'))"

# 3) 不引入新第三方依赖：确认 git diff 未触碰 pyproject.toml / requirements.txt
git diff --name-only | grep -E 'pyproject.toml|requirements.txt' && echo "FAIL: dependency changed" || echo "OK"
```

---

## 7. no-scope-creep 边界

实施本 Subplan 时，`git status` 里**只应出现**第 2 节 In scope 列出的 6 个新文件。如果出现任何既有文件的修改，说明越界了，回退。

特别地：看到 `react_agent_async.py` 的 `tc_id` 不一致（第 1 节第 3 点）**不要顺手修**——那是 Subplan 02 的 t1，在这里改会让 02 的验收失去基线。
