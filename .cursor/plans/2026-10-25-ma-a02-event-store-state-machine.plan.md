# MA-A02 事件存储、会话状态机与运行时事件映射

Planned-with: Claude Opus 5.5
Suggested-Impl-Model: Grok 4.7
Parent: .cursor/plans/2026-10-25-managed-agents-master.plan.md（W1）
Depends-on: MA-00（`agenticx/managed/{protocol,manifest,errors}.py`）

> 波次：W1。可与 MA-A01 并行（本子规划**不** import `agenticx.managed.spec` / `builder`）。MA-A03 / A04 / A05 依赖本子规划导出的名字，**名字与签名不得改**。

---

## 1. 目标

1. 持久化事件存储：每会话单调递增整数 `seq`，按 `after_seq` 分页读取；接口带 `tenant_id`，W1 提供 SQLite 实现，MA-E03 再加 PG 实现。
2. 进程内广播：持久化后的事件与不落库的预览帧推给 SSE 订阅者。
3. 会话状态机：纯逻辑，实现总规划 6.2 的状态迁移，以及 `requires_action` 批次规则（`user.message` 被拒 409、resolution 匹配 404/409/400、全部到齐才恢复运行）。
4. 运行时事件映射：把 `AgentRuntime` 产出的 `RuntimeEvent` 翻译为 MA 服务端事件（总规划 6.1）。
5. ID 与时间工具：26 位 ULID、UTC ISO 时间串。

## 2. 根因 / 动机与证据链

- 总规划第 4 节决策 5、6：ID 一律 26 位 ULID；续流以每会话单调 `seq` 为准，预览帧（`event_start` / `event_delta`）不落库、不占 `seq`。
- 仓库内**没有** ULID 工具（2026-10-25 `rg "ulid"` 于 `agenticx/` 无命中），本子规划新建 `agenticx/managed/ids.py`。
- 现有 `agenticx/studio/session_event_hub.py` 的 seq 语义可借鉴但不能复用：
  - `SessionEventHub.publish`（`session_event_hub.py:82-93`）在锁内 `self._seq += 1` 分配 seq，环形缓冲 `deque(maxlen=400)`（`:21`、`:55`）——只在内存，进程重启 seq 归零，缓冲溢出即丢事件。
  - `subscribe()`（`:169-179`）返回「订阅时的当前 seq」，`replay_since(since_seq)`（`:184-190`）只返回 `seq > since`。我们采用同样的「先订阅、再回放、再按 seq 去重」顺序，但回放数据来自持久化存储。
  - 本子规划**不修改** `session_event_hub.py`（总规划第 9 节 MA-A02 行明确要求）。
- 运行时事件形态：`agenticx/runtime/events.py:29-55` `EventType`，`:58-87` `RuntimeEvent(type, data, agent_id, private_data)`。关键 payload（均已在代码中核对）：
  - `ROUND_START`：`data={"round", "max_rounds"}`（`agent_runtime.py:4823-4827`）。
  - `TOKEN`：`data={"text"}`（`agent_runtime.py:5275-5279`）。
  - `TOOL_CALL`：`data={"name", "arguments", "tool_call_id"}`（`agent_runtime.py:7671-7675`）。
  - `TOOL_RESULT`：`data={"name", "result", "tool_call_id", "is_error"?}`（`agent_runtime.py:7438-7447` 等）。
  - `FINAL`：`data={"text", "turn_terminal", "terminal_reason", "reasoning"?, "usage_metadata"?, ...}`（`agent_runtime.py:4048-4074`）；`usage_metadata` 含 `input_tokens` / `output_tokens` / `cached_tokens` 及 `turn_input_tokens` / `turn_output_tokens` / `turn_cached_tokens`（`agent_runtime.py:4022-4041`）。
  - `ERROR`：中断时 `data={"text": STOP_MESSAGE}`，`STOP_MESSAGE = "已中断当前生成"`（`agent_runtime.py:551`、`:4798`、`:7812`）；轮次耗尽 `data={"text", "rounds_exhausted": True, ...}`（`agent_runtime.py:8217-8230`）；被 hook 拦截的工具会带 `tool_call_id`（`agent_runtime.py:7433-7437`）；告警带 `severity: "warning"`，可重试告警带 `retryable: True`（`agent_runtime.py:5965-5973`）；致命错误 `severity: "error"` 或无 severity（`agent_runtime.py:5925-5936`）。
  - `SUBAGENT_PAUSED`：`agent_id != "meta"` 时的轮次耗尽（`agent_runtime.py:8231-8243`）。MA-A01 固定 `agent_id="meta"`，这里仍兼容映射。
- 自定义工具与 `always_ask` 的时序约束（决定了「工具使用账本」的设计）：
  - 权限 hook `before_tool_call` 在 `TOOL_CALL` 事件 **之前** 被 await（`agent_runtime.py:7394` 先于 `:7671`），而且 hook 签名 `before_tool_call(tool_name, arguments, session)`（`agenticx/runtime/hooks/__init__.py:33-39`）拿不到 `tool_call_id`。
  - 所以 `always_ask` 时，`agent.tool_use` 事件必须由 hook 侧先行落库（MA-A03），等批准后 runtime 才 yield `TOOL_CALL`。映射器需要一个「账本」把后到的 `TOOL_CALL.tool_call_id` 绑定回先行落库的事件 id，避免重复发 `agent.tool_use`。
  - 工具调用在一轮内**串行**执行（`agent_runtime.py:6997` `for call in tool_calls:`；`AGX_PARALLEL_TOOLS` 只影响日志，`:6990-6995`），因此 FIFO 绑定是确定性的。

## 3. In scope / Out of scope

**In scope（只能创建这些文件）：**
- `agenticx/managed/ids.py`
- `agenticx/managed/events/__init__.py`
- `agenticx/managed/events/store.py`
- `agenticx/managed/events/sqlite_store.py`
- `agenticx/managed/events/broadcast.py`
- `agenticx/managed/events/state_machine.py`
- `agenticx/managed/events/adapter.py`
- `tests/managed/test_ids.py`
- `tests/managed/test_sqlite_store.py`
- `tests/managed/test_broadcast.py`
- `tests/managed/test_state_machine.py`
- `tests/managed/test_event_adapter.py`

**Out of scope：**
- 任何 HTTP / SSE 路由（MA-A04）；Work Queue 表（MA-A05）；PG 实现（MA-E03）。
- 修改 `agenticx/studio/session_event_hub.py` 或任何 `agenticx/runtime/**` 文件。
- `rescheduling` 状态的自动重试逻辑：W1 宿主不做自动重试，状态机保留该状态的迁移入口但 W1 无代码路径进入它。
- 线程事件（`thread_id` 非空）：字段透传存储，W1 不产生（MA-A08）。

## 4. 模块设计

文件头统一：

```python
#!/usr/bin/env python3
"""<English description>.

Author: Damon Li
"""
```

英文注释，绝对 import，import 置顶。

### 4.1 `agenticx/managed/ids.py`

```python
from __future__ import annotations

import re
import secrets
import time
from datetime import datetime, timezone

CROCKFORD32 = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"
ULID_RE = re.compile(r"^[0-9A-HJKMNP-TV-Z]{26}$")

def new_ulid(now_ms: int | None = None) -> str:
    """48-bit big-endian millisecond timestamp + 80 random bits, Crockford base32, 26 chars."""
    ts = int(time.time() * 1000) if now_ms is None else int(now_ms)
    value = (ts << 80) | secrets.randbits(80)
    chars = []
    for _ in range(26):
        chars.append(CROCKFORD32[value & 31])
        value >>= 5
    return "".join(reversed(chars))

def is_ulid(value: object) -> bool:
    return isinstance(value, str) and ULID_RE.fullmatch(value) is not None

def utc_now_iso(now: datetime | None = None) -> str:
    """UTC ISO-8601 with millisecond precision and 'Z', e.g. 2026-10-25T06:00:00.123Z.
    Fixed width so lexicographic order equals time order."""
    dt = (now or datetime.now(timezone.utc)).astimezone(timezone.utc)
    return dt.strftime("%Y-%m-%dT%H:%M:%S.") + f"{dt.microsecond // 1000:03d}Z"

def parse_iso(value: str) -> datetime:
    """Inverse of utc_now_iso (accepts the trailing 'Z')."""
```

`__all__ = ["CROCKFORD32", "ULID_RE", "new_ulid", "is_ulid", "utc_now_iso", "parse_iso"]`。

### 4.2 `agenticx/managed/events/store.py`

```python
from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any, Mapping, Sequence

from agenticx.managed.protocol import SessionRecord

ENVELOPE_KEYS: frozenset[str] = frozenset(
    {"id", "session_id", "seq", "thread_id", "type", "created_at", "processed_at"}
)
ALLOWED_SESSION_UPDATE_KEYS: frozenset[str] = frozenset(
    {"status", "stop_reason", "usage", "title", "archived_at"}
)
MAX_LIST_LIMIT = 500


@dataclass(frozen=True)
class StoredEvent:
    id: str
    tenant_id: str
    session_id: str
    seq: int
    type: str
    payload: Mapping[str, Any]        # event body without ENVELOPE_KEYS
    created_at: str
    thread_id: str | None = None
    processed_at: str | None = None

    def to_wire(self) -> dict[str, Any]:
        """{"id","session_id","seq","type", **payload, "created_at", ["thread_id"], ["processed_at"]}
        None-valued optional envelope keys are omitted. tenant_id is never exposed."""


class EventStore(ABC):
    @abstractmethod
    async def create_session(self, record: SessionRecord) -> SessionRecord: ...
    @abstractmethod
    async def get_session(self, tenant_id: str, session_id: str) -> SessionRecord | None: ...
    @abstractmethod
    async def update_session(self, tenant_id: str, session_id: str, changes: Mapping[str, Any]) -> SessionRecord: ...
    @abstractmethod
    async def list_sessions(self, tenant_id: str, *, agent_id: str | None = None, limit: int = 50) -> list[SessionRecord]: ...
    @abstractmethod
    async def list_unsettled_sessions(self) -> list[SessionRecord]: ...
    @abstractmethod
    async def append_events(self, tenant_id: str, session_id: str, events: Sequence[Mapping[str, Any]]) -> list[StoredEvent]: ...
    @abstractmethod
    async def list_events(self, tenant_id: str, session_id: str, *, after_seq: int = 0, limit: int = 100, types: Sequence[str] | None = None) -> list[StoredEvent]: ...
    @abstractmethod
    async def get_event(self, tenant_id: str, session_id: str, event_id: str) -> StoredEvent | None: ...
    @abstractmethod
    async def mark_processed(self, tenant_id: str, session_id: str, event_ids: Sequence[str], processed_at: str) -> None: ...
    @abstractmethod
    async def last_seq(self, tenant_id: str, session_id: str) -> int: ...
    @abstractmethod
    async def close(self) -> None: ...
```

方法语义（实现必须遵守，PG 实现也遵守）：

| 方法 | 语义 |
|------|------|
| `create_session` | 插入；`record.id` 已存在 → `ValueError("session already exists")`。初始 `last_seq = 0`。返回插入后的记录 |
| `get_session` | 按 `(tenant_id, id)` 查；租户不匹配视为不存在，返回 None |
| `update_session` | `changes` 的键必须 ⊆ `ALLOWED_SESSION_UPDATE_KEYS`，否则 `ValueError`。值：`status: str`、`stop_reason: dict | None`（StopReason 的 wire dict）、`usage: dict`（Usage 的 wire dict）、`title: str | None`、`archived_at: str | None`。总是同时刷新 `updated_at`。会话不存在 → `MAError(SESSION_NOT_FOUND, "session not found")`。返回更新后记录 |
| `list_sessions` | 按 `created_at` 降序；`limit` 夹到 1..500 |
| `list_unsettled_sessions` | **跨租户**，返回 `status IN ('running','rescheduling')` 或（`status='idle'` 且 `stop_reason.type == 'requires_action'`）的会话；用于宿主启动恢复 |
| `append_events` | 原子：要么全部写入并分配连续 seq（`last_seq+1 ... last_seq+n`），要么一条不写。每个 mapping 必须含 `type`；可含 `id`（必须 `is_ulid`，否则 `MAError(INVALID_EVENT_BATCH, "events[<i>].id: must be a ULID", details={"index": i})`；缺省则生成）、`thread_id`、`processed_at`；`session_id`/`seq`/`created_at` 若存在则**忽略**（服务端分配）；其余键写入 payload。`id` 重复 → `MAError(INVALID_EVENT_BATCH, "duplicate event id")`。会话不存在 → `MAError(SESSION_NOT_FOUND, ...)`。空序列 → 返回 `[]` 不开事务 |
| `list_events` | `seq > after_seq`，按 seq 升序，`limit` 夹到 1..500；`types` 非空时按 type 过滤 |
| `get_event` | 按 `(tenant_id, session_id, id)` |
| `mark_processed` | 只更新 `processed_at IS NULL` 的行 |
| `last_seq` | 会话不存在返回 0 |

`EventStore` 不校验事件 payload 的协议合法性（那是 `EventLog.append` 的职责，§4.4）。

### 4.3 `agenticx/managed/events/sqlite_store.py`

```python
class SqliteEventStore(EventStore):
    def __init__(self, path: Path) -> None: ...
    @property
    def connection(self) -> sqlite3.Connection: ...   # shared with MA-A05 work queue
    @property
    def lock(self) -> threading.RLock: ...
```

实现要求：
- `path.parent.mkdir(parents=True, exist_ok=True)`；`sqlite3.connect(str(path), check_same_thread=False, isolation_level=None)`（autocommit，事务用显式 `BEGIN IMMEDIATE`）；`PRAGMA journal_mode=WAL`、`PRAGMA foreign_keys=ON`、`PRAGMA busy_timeout=5000`；`row_factory = sqlite3.Row`。
- 所有数据库访问在 `with self._lock:`（`threading.RLock`）内完成。异步方法内**直接同步调用** sqlite（W1 开发态、本地文件、单连接；不使用 `asyncio.to_thread`，避免多线程共享连接的竞态）。
- 构造时执行下列 DDL（`executescript`），并 `PRAGMA user_version = 1`：

```sql
CREATE TABLE IF NOT EXISTS ma_sessions (
  id                  TEXT PRIMARY KEY,
  tenant_id           TEXT NOT NULL,
  agent_id            TEXT NOT NULL,
  agent_version       INTEGER NOT NULL,
  environment_id      TEXT,
  created_by_user_id  TEXT,
  source              TEXT NOT NULL,
  status              TEXT NOT NULL,
  stop_reason         TEXT,                       -- JSON or NULL
  title               TEXT,
  vault_ids           TEXT NOT NULL DEFAULT '[]', -- JSON array
  resources           TEXT NOT NULL DEFAULT '[]', -- JSON array
  usage               TEXT NOT NULL DEFAULT '{}', -- JSON object
  last_seq            INTEGER NOT NULL DEFAULT 0,
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL,
  archived_at         TEXT
);
CREATE INDEX IF NOT EXISTS ix_ma_sessions_tenant_created ON ma_sessions(tenant_id, created_at);
CREATE INDEX IF NOT EXISTS ix_ma_sessions_status ON ma_sessions(status);

CREATE TABLE IF NOT EXISTS ma_session_events (
  id            TEXT PRIMARY KEY,
  tenant_id     TEXT NOT NULL,
  session_id    TEXT NOT NULL REFERENCES ma_sessions(id) ON DELETE CASCADE,
  seq           INTEGER NOT NULL,
  thread_id     TEXT,
  type          TEXT NOT NULL,
  payload       TEXT NOT NULL,                    -- JSON object (body without envelope keys)
  created_at    TEXT NOT NULL,
  processed_at  TEXT,
  UNIQUE (session_id, seq)
);
CREATE INDEX IF NOT EXISTS ix_ma_events_session_seq ON ma_session_events(session_id, seq);
CREATE INDEX IF NOT EXISTS ix_ma_events_session_type ON ma_session_events(session_id, type, seq);
```

- JSON 列用 `json.dumps(value, ensure_ascii=False, separators=(",", ":"))` 写、`json.loads` 读。`SessionRecord` 从行重建时 `stop_reason` 为 None 或 `StopReason.model_validate(...)`；`usage` 为 `Usage.model_validate(...)`；用 `SessionRecord.model_validate(dict)` 构造。
- `create_session` 写入：`record.model_dump(mode="json")` 的各字段对应列。
- `append_events` 算法（锁内）：

```text
cur.execute("BEGIN IMMEDIATE")
try:
    row = SELECT last_seq FROM ma_sessions WHERE id=? AND tenant_id=?
    if row is None: raise MAError(SESSION_NOT_FOUND, "session not found")
    seq = row["last_seq"]; now = utc_now_iso(); out = []
    for i, ev in enumerate(events):
        eid = ev.get("id") or new_ulid()
        if not is_ulid(eid): raise MAError(INVALID_EVENT_BATCH, f"events[{i}].id: must be a ULID", details={"index": i})
        seq += 1
        payload = {k: v for k, v in ev.items() if k not in ENVELOPE_KEYS}
        INSERT INTO ma_session_events(id,tenant_id,session_id,seq,thread_id,type,payload,created_at,processed_at)
        out.append(StoredEvent(...))
    UPDATE ma_sessions SET last_seq=?, updated_at=? WHERE id=?
    cur.execute("COMMIT")
except sqlite3.IntegrityError:
    cur.execute("ROLLBACK"); raise MAError(INVALID_EVENT_BATCH, "duplicate event id")
except BaseException:
    cur.execute("ROLLBACK"); raise
```

- `list_unsettled_sessions`：`SELECT * FROM ma_sessions WHERE status IN ('running','rescheduling') OR (status='idle' AND json_extract(stop_reason,'$.type')='requires_action')`。
- `close()`：关闭连接（幂等）。

### 4.4 `agenticx/managed/events/broadcast.py`

```python
from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
from typing import Any, Literal, Mapping, Sequence

from agenticx.managed.errors import INVALID_EVENT_BATCH, MAError
from agenticx.managed.events.store import EventStore, StoredEvent
from agenticx.managed.protocol import CLIENT_EVENT_TYPES, SERVER_EVENT_TYPES, parse_client_events, parse_server_event

DEFAULT_SUBSCRIBER_QUEUE_MAXSIZE = 1000


@dataclass(frozen=True)
class BroadcastItem:
    kind: Literal["event", "preview", "close"]
    event: StoredEvent | None = None
    frame: Mapping[str, Any] | None = None


@dataclass
class Subscription:
    session_id: str
    queue: asyncio.Queue[BroadcastItem]
    overflowed: bool = False
    closed: bool = False
    _owner: "EventBroadcaster | None" = field(default=None, repr=False)

    def close(self) -> None:
        """Idempotent unsubscribe."""


class EventBroadcaster:
    def __init__(self, *, queue_maxsize: int = DEFAULT_SUBSCRIBER_QUEUE_MAXSIZE) -> None: ...
    def subscribe(self, session_id: str) -> Subscription: ...
    def publish_events(self, session_id: str, events: Sequence[StoredEvent]) -> None: ...
    def publish_preview(self, session_id: str, frame: Mapping[str, Any]) -> None: ...
    def close_session(self, session_id: str) -> None: ...
    def subscriber_count(self, session_id: str) -> int: ...


class EventLog:
    """Validate -> persist -> broadcast. The only write path used by MA-A04/MA-A05."""

    def __init__(self, store: EventStore, broadcaster: EventBroadcaster) -> None: ...
    @property
    def store(self) -> EventStore: ...
    @property
    def broadcaster(self) -> EventBroadcaster: ...
    async def append(self, tenant_id: str, session_id: str, events: Sequence[Mapping[str, Any]]) -> list[StoredEvent]: ...
    def publish_preview(self, session_id: str, frame: Mapping[str, Any]) -> None: ...
```

规则：
- `publish_*` 对每个订阅者 `queue.put_nowait(item)`；`asyncio.QueueFull` → 该订阅者 `overflowed = True`、`closed = True`、从订阅表移除（不阻塞发布方，也不再往它的队列放东西）。SSE 消费方每次 `get` 前后检查 `sub.overflowed`，为 True 即结束流，客户端用 `Last-Event-ID` 重连，因持久化而不丢数据。
- `close_session`：向每个订阅者放 `BroadcastItem(kind="close")`（队列满则同样标记 overflowed），然后清空该会话订阅表。
- `subscribe` 必须在事件循环中调用（`asyncio.Queue` 在此创建）。
- `EventLog.append` 校验：逐条看 `type`：
  - ∈ `SERVER_EVENT_TYPES` → `parse_server_event(dict(ev))`，pydantic 异常 → `MAError(INVALID_EVENT_BATCH, f"events[{i}]: invalid", details={"index": i})`；
  - ∈ `CLIENT_EVENT_TYPES` → `parse_client_events({"events": [dict(ev)]})`，`MAError` 透传但 `details["index"]` 改为 `i`；
  - 其他 → `MAError(INVALID_EVENT_BATCH, f"events[{i}]: unknown event type", details={"index": i})`。
  - 全部校验通过后才调用 `store.append_events`；成功后 `broadcaster.publish_events(session_id, stored)` 并返回 `stored`。

### 4.5 `agenticx/managed/events/state_machine.py`

```python
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Literal, Mapping, Sequence, Union

from agenticx.managed.errors import (
    INVALID_EVENT_BATCH, INVALID_REQUEST, RESOLUTION_CONFLICT, RESOLUTION_NOT_FOUND,
    SESSION_REQUIRES_ACTION, SESSION_TERMINATED, MAError,
)
from agenticx.managed.ids import new_ulid
from agenticx.managed.protocol import ClientEvent, SessionStatus, StopReason, StopReasonType

ActionKind = Literal["tool_confirmation", "custom_tool_result"]
KIND_BY_EVENT_TYPE: Mapping[str, ActionKind] = {
    "agent.tool_use": "tool_confirmation",
    "agent.mcp_tool_use": "tool_confirmation",
    "agent.custom_tool_use": "custom_tool_result",
}
KIND_BY_RESOLUTION_TYPE: Mapping[str, ActionKind] = {
    "user.tool_confirmation": "tool_confirmation",
    "user.custom_tool_result": "custom_tool_result",
}


@dataclass(frozen=True)
class PendingAction:
    event_id: str
    kind: ActionKind


@dataclass(frozen=True)
class SubmitMessage:
    index: int                                  # index into the client batch


@dataclass(frozen=True)
class ResolveActions:
    resolutions: Mapping[str, ClientEvent]      # tool use event id -> resolving client event (may come from earlier batches)


@dataclass(frozen=True)
class InterruptTurn:
    dropped_pending: tuple[str, ...]            # pending event ids voided by the interrupt


Effect = Union[SubmitMessage, ResolveActions, InterruptTurn]


@dataclass(frozen=True)
class StateSnapshot:
    status: SessionStatus
    stop_reason: StopReason | None
    pending: tuple[PendingAction, ...]
    resolved: Mapping[str, ClientEvent]         # partial resolutions of the current requires_action batch


@dataclass(frozen=True)
class ClientBatchPlan:
    events: tuple[ClientEvent, ...]
    effects: tuple[Effect, ...]
    final: StateSnapshot                        # state to apply on commit


def status_running_event() -> dict[str, Any]:
    return {"id": new_ulid(), "type": "session.status_running"}

def status_idle_event(stop_type: StopReasonType, event_ids: Sequence[str] = ()) -> dict[str, Any]:
    return {"id": new_ulid(), "type": "session.status_idle",
            "stop_reason": {"type": stop_type, "event_ids": list(event_ids)}}

def session_error_event(error_type: str, message: str, retry: Literal["retrying", "exhausted", "terminal"]) -> dict[str, Any]:
    return {"id": new_ulid(), "type": "session.error",
            "error": {"type": error_type, "message": message, "retry_status": {"type": retry}}}


class SessionStateMachine:
    def __init__(self, status: SessionStatus = "idle", stop_reason: StopReason | None = None,
                 pending: Sequence[PendingAction] = ()) -> None: ...

    @property
    def status(self) -> SessionStatus: ...
    @property
    def stop_reason(self) -> StopReason | None: ...
    @property
    def pending(self) -> tuple[PendingAction, ...]: ...
    @property
    def requires_action(self) -> bool:
        """status == 'idle' and stop_reason.type == 'requires_action'."""

    def snapshot(self) -> StateSnapshot: ...
    def restore(self, snap: StateSnapshot) -> None: ...

    def plan_client_events(self, events: Sequence[ClientEvent],
                           known_event_types: Mapping[str, str]) -> ClientBatchPlan: ...
    def commit(self, plan: ClientBatchPlan) -> list[dict[str, Any]]: ...

    def turn_started(self) -> list[dict[str, Any]]: ...
    def action_required(self, actions: Sequence[PendingAction]) -> list[dict[str, Any]]: ...
    def turn_finished(self, stop_type: StopReasonType) -> list[dict[str, Any]]: ...
    def apply_ingested_status(self, event: Mapping[str, Any],
                              pending_kinds: Mapping[str, ActionKind]) -> None: ...
    def archive(self) -> None: ...
    def recover_after_restart(self) -> list[dict[str, Any]]: ...
```

**`plan_client_events` 规则（纯函数，不改 self；任一错误抛 `MAError`，整批零写入）：**

先整批检查：
- `status == "terminated"` → `MAError(SESSION_TERMINATED, "session is terminated")`
- `status == "archived"` → `MAError(SESSION_TERMINATED, "session is archived")`

模拟状态 `sim_status`、`sim_stop`、`sim_pending: dict[id, kind]`、`sim_resolved: dict[id, ClientEvent]` 从 self 复制（`dict(...)` 浅拷贝，绝不原地修改 self 的容器）。逐条 `i, ev`：

| 事件 | 条件 | 结果 |
|------|------|------|
| `user.message` | sim 处于 requires_action | `MAError(SESSION_REQUIRES_ACTION, f"events[{i}]: session requires action", details={"index": i, "event_ids": sorted(sim_pending)})` |
| `user.message` | 其他（idle / running / rescheduling） | effect `SubmitMessage(i)`；**不改** sim_status（实际 `idle→running` 由执行器调用 `turn_started()` 完成） |
| `user.interrupt` | sim 处于 requires_action | effect `InterruptTurn(tuple(sorted(sim_pending)))`；`sim_status="running"`、`sim_stop=None`、清空 pending/resolved（运行时正在收尾，收尾完成由 `turn_finished("end_turn")` 置回 idle） |
| `user.interrupt` | sim_status ∈ {running, rescheduling} | effect `InterruptTurn(())` |
| `user.interrupt` | idle（非 requires_action） | 无 effect（接受并落库，无副作用） |
| `user.tool_confirmation`（`tool_use_id`）/ `user.custom_tool_result`（`custom_tool_use_id`） | `known_event_types.get(id)` 为 None | `MAError(RESOLUTION_NOT_FOUND, f"events[{i}]: tool use {id} not found", details={"index": i})` → 404 |
| 同上 | `KIND_BY_EVENT_TYPE.get(t) != KIND_BY_RESOLUTION_TYPE[ev.type]` | `MAError(INVALID_REQUEST, f"events[{i}]: {ev.type} cannot resolve {t}", details={"index": i})` → 400 |
| 同上 | sim 非 requires_action，或 `id not in sim_pending`，或 `id in sim_resolved` | `MAError(RESOLUTION_CONFLICT, f"events[{i}]: tool use {id} is not awaiting resolution", details={"index": i})` → 409 |
| 同上 | 合法 | `sim_resolved[id] = ev`；若 `set(sim_resolved) == set(sim_pending)`：effect `ResolveActions(dict(sim_resolved))`，`sim_status="running"`、`sim_stop=None`、清空 pending/resolved |

检查顺序固定为 404 → 400 → 409。`known_event_types` 由调用方（MA-A04 actor）事先按批内引用的 id 查存储得到：`{event_id: stored.type}`。

`commit(plan)`：把 `plan.final` 写回 self；返回服务端事件：若 effects 中含 `ResolveActions` → `[status_running_event()]`，否则 `[]`。（中断 requires_action 不产生事件；收尾时由 `turn_finished` 产生 `status_idle(end_turn)`。）

**运行侧迁移：**

| 方法 | 允许的前置状态 | 结果 | 返回事件 |
|------|----------------|------|----------|
| `turn_started()` | `idle` 且非 requires_action | `running`，stop_reason=None | `[status_running_event()]` |
| `action_required(actions)` | `running`；`actions` 非空 | `idle` + `StopReason(type="requires_action", event_ids=[a.event_id...])`，pending=actions，resolved 清空 | `[status_idle_event("requires_action", ids)]` |
| `turn_finished(stop_type)` | `running` / `rescheduling` / requires_action；`stop_type != "requires_action"` | `idle` + `StopReason(type=stop_type)`，pending/resolved 清空 | `[status_idle_event(stop_type)]` |
| `archive()` | `idle` 且非 requires_action | `archived`，stop_reason 保持 | 无 |
| `recover_after_restart()` | 任意 | 若 `running` / `rescheduling` / requires_action → `idle` + `retries_exhausted`；否则不变 | 前者返回 `[session_error_event("host_restarted", "session was interrupted by a host restart", "exhausted"), status_idle_event("retries_exhausted")]`，后者 `[]` |

前置状态不满足 → `raise RuntimeError(f"illegal transition from {status}")`（编程错误，不是 API 错误）。`archive()` 前置不满足时抛 `MAError(INVALID_REQUEST, "session must be idle to archive")`（这个会被 API 直接返回）。

**`apply_ingested_status(event, pending_kinds)`**（MA-A05 Worker 回传状态事件时用）：
- `type == "session.status_running"`：要求 `idle` 且非 requires_action → `running`；否则 `MAError(INVALID_EVENT_BATCH, "invalid status transition: session.status_running")`。
- `type == "session.status_idle"` 且 `stop_reason.type == "requires_action"`：要求 `running`；`event_ids` 中每个 id 必须在 `pending_kinds` 中，否则 `MAError(INVALID_EVENT_BATCH, f"requires_action references unknown tool use {id}")`；迁移同 `action_required`（不生成新事件）。
- `type == "session.status_idle"` 其他：要求 `running` / `rescheduling` / requires_action → idle；否则 `MAError(INVALID_EVENT_BATCH, "invalid status transition: session.status_idle")`。
- `type == "session.status_terminated"`：`MAError(INVALID_EVENT_BATCH, "workers cannot terminate sessions")`。
- 其他类型：无操作。

### 4.6 `agenticx/managed/events/adapter.py`

```python
from __future__ import annotations

import json
import time
from dataclasses import dataclass, field
from typing import Any, Callable, Literal, Mapping

from agenticx.managed.events.state_machine import session_error_event
from agenticx.managed.ids import new_ulid
from agenticx.managed.protocol import StopReasonType, Usage
from agenticx.runtime.agent_runtime import STOP_MESSAGE
from agenticx.runtime.events import EventType, RuntimeEvent

ToolKind = Literal["builtin", "mcp", "custom"]          # same literals as agenticx.managed.spec.ToolKind
TOOL_RESULT_MAX_CHARS = 65536
TRUNCATION_SUFFIX = "\n[truncated]"


@dataclass
class AnnouncedToolUse:
    event_id: str
    kind: ToolKind
    name: str
    mcp_server: str | None = None
    tool_call_id: str | None = None


class ToolUseLedger:
    def record(self, use: AnnouncedToolUse) -> None: ...          # append to unbound FIFO
    def bind(self, tool_call_id: str, name: str) -> AnnouncedToolUse | None:
        """Pop the FIFO head iff head.name == name; set tool_call_id; index it. Else None."""
    def by_call_id(self, tool_call_id: str) -> AnnouncedToolUse | None: ...
    def inflight_custom(self, name: str) -> str | None:
        """event_id of the most recent bound custom tool use with this name not yet finished."""
    def finish(self, tool_call_id: str) -> None: ...
    def reset_turn(self) -> None: ...                              # drop unbound FIFO leftovers


@dataclass
class AdapterOutput:
    events: list[dict[str, Any]] = field(default_factory=list)     # server events to persist (each has "id")
    previews: list[dict[str, Any]] = field(default_factory=list)   # preview frames, never persisted


@dataclass
class TurnOutcome:
    stop_type: StopReasonType
    events: list[dict[str, Any]]
    usage: Usage


class RuntimeEventAdapter:
    def __init__(self, *, model_ref: str, kind_of: Callable[[str], ToolKind | None],
                 ledger: ToolUseLedger | None = None,
                 clock: Callable[[], float] = time.monotonic) -> None: ...
    @property
    def ledger(self) -> ToolUseLedger: ...
    def begin_turn(self, base_usage: Usage) -> None: ...
    def build_tool_use(self, *, kind: ToolKind, name: str, input: Mapping[str, Any],
                       evaluated_policy: Literal["always_allow", "always_ask"] | None,
                       mcp_server: str | None = None) -> list[dict[str, Any]]: ...
    def convert(self, event: RuntimeEvent) -> AdapterOutput: ...
    def mark_interrupted(self) -> None: ...
    def finish_turn(self, *, error: BaseException | None = None) -> TurnOutcome: ...
```

**内部状态（每轮 `begin_turn` 重置）：** `_span_open: bool`、`_message_started: bool`（本次模型请求是否已发过 `event_start`）、`_stashed_error: dict | None`、`_interrupted`、`_rounds_exhausted`、`_saw_final`、`_tool_calls: int`、`_turn_usage: Usage`、`_last_request_usage: Usage`、`_started_at: float`、`_base_usage: Usage`；`begin_turn` 同时调用 `ledger.reset_turn()`。

**`build_tool_use`**（MA-A03 hook 与本类 TOOL_CALL 兜底共用）：
1. 输入清洗：去掉以 `"__"` 开头的键；`json.loads(json.dumps(input, ensure_ascii=False, default=str))` 保证可序列化。
2. 结果列表先放 `_close_span()` 的产出（若 span 打开，产出 `span.model_request_end`）。
3. 事件 id = `new_ulid()`；按 kind：
   - `builtin` → `{"id", "type": "agent.tool_use", "name", "input", "evaluated_policy": policy or "always_allow"}`
   - `mcp` → `{"id", "type": "agent.mcp_tool_use", "mcp_server", "name", "input", "evaluated_policy": policy or "always_allow"}`
   - `custom` → `{"id", "type": "agent.custom_tool_use", "name", "input"}`
4. `ledger.record(AnnouncedToolUse(event_id, kind, name, mcp_server))`；返回列表（最后一个元素就是 tool use 事件）。

**`convert(event)` 映射表：**

| RuntimeEvent.type | 处理 |
|-------------------|------|
| `round_start` | 先 flush 暂存错误（见下）；若 span 已开先关；产出 `{"id", "type": "span.model_request_start", "model": model_ref}`；`_span_open=True`、`_message_started=False` |
| `token` | `text = data["text"]`；空串忽略；若 `not _message_started`：previews 追加 `{"type": "event_start", "event": {"type": "agent.message"}}` 并置 True；previews 追加 `{"type": "event_delta", "event_type": "agent.message", "content_delta": text}` |
| `tool_call` | flush 暂存错误；`_tool_calls += 1`；`use = ledger.bind(tool_call_id, name)`；若 use 为 None：`kind = kind_of(name) or "builtin"`，`events += build_tool_use(kind=kind, name=name, input=arguments, evaluated_policy="always_allow" if kind != "custom" else None)`，再 `ledger.bind(tool_call_id, name)`；若 use 非 None：只需 `_close_span()`（hook 先行落库时 span 已在 build_tool_use 里关闭，此处通常无产出） |
| `tool_result` | flush 暂存错误；`use = ledger.by_call_id(tool_call_id)`；None → 忽略；`text = str(data.get("result", ""))` 截断到 `TOOL_RESULT_MAX_CHARS` 并加 `TRUNCATION_SUFFIX`；`is_error = bool(data.get("is_error")) or text.startswith(("ERROR:", "CANCELLED:"))`；`content = [{"type":"text","text":text}] if text else []`；`builtin` → `{"id","type":"agent.tool_result","tool_use_id":use.event_id,"content","is_error"}`；`mcp` → `{"id","type":"agent.mcp_tool_result","mcp_tool_use_id":use.event_id,"content","is_error"}`；`custom` → 不产出（调用方回传的 `user.custom_tool_result` 即为记录）；最后 `ledger.finish(tool_call_id)` |
| `final` | flush 暂存错误（作为 `retrying`）；`_saw_final=True`；读 `usage_metadata`（可能缺失）：本次请求用量 `Usage(input_tokens=um.input_tokens, output_tokens=um.output_tokens, cache_read_input_tokens=um.cached_tokens)`，本轮用量 `turn_* or 非 turn 值`；关 span（end 带 `model_usage=本次请求用量`）；`reasoning` 非空 → `{"id","type":"agent.thinking","content":[{"type":"text","text":reasoning}]}`；`text` 非空 → `{"id","type":"agent.message","content":[{"type":"text","text":text}]}` |
| `error` | 见下方错误规则 |
| `subagent_paused` | `_rounds_exhausted=True` |
| 其他（`tool_progress`、`tool_call_delta`、`content_block`、`context_stats`、`compaction`、`round_end`、`stall`、`confirm_*`、`clarification_*`、`subagent_*`） | 不产出 |

**错误规则（`error` 事件）：**
1. `data.get("text") == STOP_MESSAGE` → `_interrupted=True`；关 span（`is_error=False`）；无事件。
2. `data.get("tool_call_id")` 非空 → 无事件（工具级错误由随后的 `tool_result` 承载）。
3. `data.get("rounds_exhausted") is True` → `_rounds_exhausted=True`；关 span；无事件。
4. `severity = data.get("severity") or "error"`；`severity == "warning"`：`retryable is True` → 产出 `session_error_event(detector or "runtime_warning", text, "retrying")`；否则无事件。
5. 其他（致命错误）：先 flush 已暂存错误为 `retrying`；再把本条暂存为 `_stashed_error = {"type": detector or "runtime_error", "message": text}`。

「flush 暂存错误」= 若 `_stashed_error` 非空，产出 `session_error_event(type, message, "retrying")` 并清空。

**`_close_span(is_error=False, model_usage=None)`**：span 打开时产出 `{"id","type":"span.model_request_end","model":model_ref,"is_error":is_error,"model_usage":(model_usage or Usage()).model_dump()}` 并置 `_span_open=False`。

**`finish_turn(error=None)` → `TurnOutcome`：**
1. `events = []`；`fatal = error is not None or _stashed_error is not None`。
2. span 若开着：关闭，`is_error = fatal and not _interrupted`。
3. 若 `error is not None`：`events.append(session_error_event("internal_error", f"{type(error).__name__}: {error}"[:500], "exhausted"))`；否则若 `_stashed_error`：`events.append(session_error_event(**stashed, retry="exhausted"))`。（中断时不报暂存错误：`_interrupted` 为 True 则丢弃暂存。）
4. `stop_type` 优先级：`_interrupted` → `end_turn`；`_rounds_exhausted` → `max_tool_rounds`；`fatal` → `retries_exhausted`；其他 → `end_turn`。
5. 累计用量：`usage = base + turn`（逐字段相加），`tool_calls += _tool_calls`，`runtime_ms += int((clock() - _started_at) * 1000)`。
6. `events.append({"id": new_ulid(), "type": "session.usage", "usage": usage.model_dump()})`。
7. 返回 `TurnOutcome(stop_type, events, usage)`。状态事件 `session.status_idle` **不**由适配器产出，由调用方 `sm.turn_finished(stop_type)` 产出。

`mark_interrupted()`：调用方强制取消运行时任务（宽限期后 `task.cancel()`）时调用，等价于收到 STOP_MESSAGE。

### 4.7 `agenticx/managed/events/__init__.py`

re-export：`StoredEvent`、`EventStore`、`SqliteEventStore`、`EventBroadcaster`、`EventLog`、`Subscription`、`BroadcastItem`、`SessionStateMachine`、`PendingAction`、`ActionKind`、`SubmitMessage`、`ResolveActions`、`InterruptTurn`、`ClientBatchPlan`、`StateSnapshot`、`status_running_event`、`status_idle_event`、`session_error_event`、`RuntimeEventAdapter`、`ToolUseLedger`、`AnnouncedToolUse`、`AdapterOutput`、`TurnOutcome`、`TOOL_RESULT_MAX_CHARS`。注意：`adapter.py` 会 import `agenticx.runtime.agent_runtime`（较重）；`__init__` re-export 会让 `import agenticx.managed.events` 也拉起 runtime——这是可接受的（宿主与 Worker 本来就要跑 runtime）。

## 5. FR / NFR / AC

所有测试位于 `tests/managed/`，pytest `asyncio_mode=auto`（直接 `async def test_...`），`$HOME` 已由 `tests/conftest.py` 隔离；存储文件一律放 `tmp_path`。

| ID | 内容 | AC（文件 :: 函数 → 断言） |
|----|------|------|
| FR-1 | ULID 生成 | `test_ids.py::test_new_ulid_shape_and_order`：1000 个 `new_ulid()` 全部 `is_ulid`、互不相同；`new_ulid(now_ms=1)` < `new_ulid(now_ms=2)`（字符串比较）；`new_ulid(now_ms=0)[:10] == "0000000000"` |
| FR-2 | 时间串 | `test_ids.py::test_utc_now_iso_fixed_width`：`utc_now_iso(datetime(2026,10,25,6,0,0,123456,tzinfo=timezone.utc)) == "2026-10-25T06:00:00.123Z"`；`parse_iso` 往返误差 < 1ms |
| FR-3 | seq 单调连续 | `test_sqlite_store.py::test_append_assigns_contiguous_seq`：建会话，两次 append（2 条 + 3 条）→ seq 依次 1..5；`last_seq == 5` |
| FR-4 | 并发 append 不撞 seq | `test_sqlite_store.py::test_concurrent_appends_unique_seq`：`asyncio.gather` 20 个 append（各 1 条）→ 收集到的 seq 集合 == `set(range(1, 21))` |
| FR-5 | 分页与过滤 | `test_sqlite_store.py::test_list_events_after_seq_limit_types`：10 条交替 `agent.message`/`session.usage` → `after_seq=4, limit=3` 返回 seq [5,6,7]；`types=["session.usage"]` 只含该类型；`limit=10_000` 被夹到 500 不报错 |
| FR-6 | 持久化跨重启 | `test_sqlite_store.py::test_reopen_continues_seq`：append 3 条 → `close()` → 同路径新实例 append 1 条 → seq == 4，`list_events` 共 4 条 |
| FR-7 | 租户隔离 | `test_sqlite_store.py::test_tenant_isolation`：tenant `a` 的会话，用 tenant `b` 调 `get_session` → None；`append_events` → `MAError` code `session_not_found`；`list_events` → `[]` |
| FR-8 | id 保留与校验 | `test_sqlite_store.py::test_event_id_preserved_and_validated`：带合法 ULID 的事件写入后 `id` 不变；`id="bad"` → `MAError` code `invalid_event_batch`、`details["index"] == 0`；重复 id → `invalid_event_batch` 且第二批零写入（`last_seq` 不变） |
| FR-9 | 原子性 | `test_sqlite_store.py::test_append_is_atomic`：一批 3 条其中第 3 条 id 非法 → 抛错，`last_seq` 不变、`list_events` 为空 |
| FR-10 | to_wire | `test_sqlite_store.py::test_stored_event_to_wire`：wire 含 `id/session_id/seq/type/created_at` 与 payload 键，不含 `tenant_id`；`processed_at` 为 None 时不出现；`parse_server_event(wire)` 不抛错 |
| FR-11 | 会话更新与未决列表 | `test_sqlite_store.py::test_update_session_and_unsettled`：`update_session(..., {"status": "running"})` 后 `list_unsettled_sessions()` 含该会话；改为 `idle` + `stop_reason={"type":"requires_action","event_ids":[x]}` 仍含；改为 `idle` + `end_turn` 不含；未知键 → `ValueError` |
| FR-12 | 广播与溢出 | `test_broadcast.py::test_publish_fanout_and_overflow`：两个订阅者各收到同一事件；`queue_maxsize=2` 时发布 3 条 → 订阅者 `overflowed is True` 且 `subscriber_count == 0` |
| FR-13 | close_session | `test_broadcast.py::test_close_session_sends_close`：订阅后 `close_session` → 队列取到 `kind == "close"` |
| FR-14 | EventLog 校验后再写 | `test_broadcast.py::test_event_log_rejects_invalid_without_write`：批内第 2 条为 `{"type":"agent.message"}`（缺 content）→ `MAError` code `invalid_event_batch`、`details["index"] == 1`，`last_seq == 0`；未知 type → 同 code |
| FR-15 | requires_action 拒 user.message | `test_state_machine.py::test_message_rejected_in_requires_action`：sm running → `action_required([PendingAction(X,"tool_confirmation")])` → plan `[user.message]` → `MAError` code `session_requires_action`、`http_status == 409`、`details["event_ids"] == [X]` |
| FR-16 | resolution 404/400/409 | `test_state_machine.py::test_resolution_errors`：参数化 ①id 不在 known_event_types → `resolution_not_found` 404；②`user.custom_tool_result` 指向 `agent.tool_use` → `invalid_request` 400；③sm 为 idle(end_turn) 时确认已知 tool use → `resolution_conflict` 409；④已在本批前一次部分解决过的 id 再次解决（跨两次 commit）→ 409 |
| FR-17 | 全部到齐才恢复 | `test_state_machine.py::test_batch_resolution_resumes_only_when_complete`：pending 两个 id A、B；第一批只确认 A → effects 为空、commit 返回 `[]`、仍 requires_action；第二批确认 B → effects 恰含一个 `ResolveActions`（断言 `set(effect.resolutions) == {"A","B"}`）、commit 返回一个 `session.status_running`、`sm.status == "running"` |
| FR-18 | 批内顺序语义 | `test_state_machine.py::test_resolution_then_message_same_batch`：requires_action(A) 下一批 `[tool_confirmation(A), user.message]` → effects == `[ResolveActions, SubmitMessage(1)]`，不报 409 |
| FR-19 | 中断 | `test_state_machine.py::test_interrupt_in_requires_action`：plan `[user.interrupt]` → effect `InterruptTurn(("A",))`；commit 返回 `[]`；`sm.status == "running"`、`requires_action is False`；随后 `turn_finished("end_turn")` 返回一个 idle(end_turn) 事件 |
| FR-20 | 整批原子 | `test_state_machine.py::test_plan_is_pure_and_atomic`：requires_action(A, B) 下批 `[tool_confirmation(A, 合法), tool_confirmation(Z, Z 不在 known_event_types)]` → 抛 `resolution_not_found` 404，且 `sm.snapshot()` 与调用前相等（A 没有被记为已解决） |
| FR-21 | 终止 / 归档 | `test_state_machine.py::test_terminated_and_archived_reject_all`：`status="archived"` 时任何批 → `session_terminated` 409 |
| FR-22 | 非法迁移 | `test_state_machine.py::test_illegal_transitions_raise`：idle 调 `turn_finished` → `RuntimeError`；running 调 `turn_started` → `RuntimeError`；running 调 `archive()` → `MAError` `invalid_request` |
| FR-23 | 重启恢复 | `test_state_machine.py::test_recover_after_restart`：running → 返回 2 个事件（`session.error` 的 `error.type == "host_restarted"`、`retry_status.type == "exhausted"`；`session.status_idle` 的 `retries_exhausted`）；idle(end_turn) → `[]` |
| FR-24 | Worker 状态回传 | `test_state_machine.py::test_apply_ingested_status`：idle → running 合法；running → idle(requires_action, [A]) 且 `pending_kinds={"A":"tool_confirmation"}` 合法、`sm.pending == (PendingAction("A","tool_confirmation"),)`；requires_action 引用未知 id → `invalid_event_batch`；`session.status_terminated` → `invalid_event_batch` |
| FR-25 | 适配：一轮正常对话 | `test_event_adapter.py::test_round_tokens_final`：依次 convert `round_start`、`token("he")`、`token("llo")`、`final{text:"hello", usage_metadata:{input_tokens:10,output_tokens:5,cached_tokens:2,turn_input_tokens:10,turn_output_tokens:5}}` → 持久化事件类型序列 == `["span.model_request_start","span.model_request_end","agent.message"]`；previews == `[event_start, event_delta("he"), event_delta("llo")]`；`finish_turn()` → `stop_type == "end_turn"`，events 末尾为 `session.usage`，`usage.input_tokens == 10`、`usage.output_tokens == 5`；全部持久化事件经 `parse_server_event` 不抛错 |
| FR-26 | 适配：hook 先行落库后绑定 | `test_event_adapter.py::test_announced_tool_use_is_bound_not_duplicated`：`round_start` → `build_tool_use(kind="builtin", name="bash_exec", input={"command":"ls","__tool_call_id":"x"}, evaluated_policy="always_ask")` → 返回 `[span_end, agent.tool_use]`，`input` 不含 `__tool_call_id`；随后 convert `tool_call{name:"bash_exec", tool_call_id:"c1"}` → 无事件；`tool_result{tool_call_id:"c1", result:"ok"}` → 一个 `agent.tool_result`，`tool_use_id` 等于先前事件 id |
| FR-27 | 适配：未经 hook 的 tool_call 兜底 | `test_event_adapter.py::test_unannounced_tool_call_fallback`：直接 convert `tool_call{name:"file_read",tool_call_id:"c2"}` → 一个 `agent.tool_use`，`evaluated_policy == "always_allow"` |
| FR-28 | 适配：自定义工具 | `test_event_adapter.py::test_custom_tool_use_and_no_result_event`：`kind_of` 对 `lookup_order` 返回 `"custom"`；convert `tool_call` → 一个 `agent.custom_tool_use`（无 `evaluated_policy` 键）；`ledger.inflight_custom("lookup_order") == 该 id`；convert `tool_result` → 无事件，且之后 `inflight_custom` 返回 None |
| FR-29 | 适配：错误与重试语义 | `test_event_adapter.py::test_error_stash_flush_and_exhausted`：①`error{text:"boom"}` 后接 `round_start` → 产出一个 `session.error`，`retry_status.type == "retrying"`；②turn 末尾为致命错误 → `finish_turn` 产出 `session.error`(exhausted) 且 `stop_type == "retries_exhausted"`；③`error{text:STOP_MESSAGE}` → `stop_type == "end_turn"` 且无 `session.error`；④`error{rounds_exhausted:True}` → `stop_type == "max_tool_rounds"`；⑤`error{severity:"warning", retryable:True, detector:"x"}` → 立即产出 `session.error` 类型 `x`、retrying；⑥`error{text:"blocked", tool_call_id:"c"}` → 无事件 |
| FR-30 | 适配：结果截断与错误判定 | `test_event_adapter.py::test_tool_result_truncation_and_error_prefix`：结果长 70000 → text 长度 == `65536 + len(TRUNCATION_SUFFIX)`；结果 `"CANCELLED: x"` → `is_error is True` |
| FR-31 | 适配：异常收尾 | `test_event_adapter.py::test_finish_turn_with_exception`：`finish_turn(error=ValueError("x"))` → 含 `session.error` 类型 `internal_error`、exhausted；`stop_type == "retries_exhausted"` |
| NFR-1 | 不改既有文件 | `git status --porcelain` 仅出现第 3 节列出的新文件 |
| NFR-2 | 不 import Studio | `test_event_adapter.py::test_no_studio_imports`：读取 `agenticx/managed/ids.py` 与 `agenticx/managed/events/*.py` 源码，均不含 `agenticx.studio` |

（FR-17 另断言 `effect.resolutions["A"]` 是第一批里的那条 `UserToolConfirmation`。FR-20 以 `snapshot()` 前后相等为准，`StateSnapshot` 是 frozen dataclass，可直接 `==`。）

## 6. 验证命令

```bash
cd /Users/damon/myWork/AgenticX
pytest tests/managed/test_ids.py tests/managed/test_sqlite_store.py tests/managed/test_broadcast.py tests/managed/test_state_machine.py tests/managed/test_event_adapter.py -q --no-cov
pytest tests/test_smoke_session_event_hub.py -q --no-cov     # existing hub untouched
git status --porcelain -- agenticx tests
```

## 7. 回滚

全部为新增文件，删除即回滚。无开关：只有 MA-A04 / MA-A05 显式 import 本模块。

## 8. 不变量

- `agenticx/studio/session_event_hub.py` 与 `agenticx/runtime/**` 零改动。
- 预览帧（`event_start` / `event_delta`）永不进入 `EventStore`，永不占 `seq`。
- `seq` 在单会话内严格单调、连续、从 1 开始；同一 `(session_id, seq)` 唯一。
- 任何 `append_events` 失败都不留下部分写入。
- 状态事件（`session.status_*`）只由 `SessionStateMachine` 的方法生成（或 Worker 回传后经 `apply_ingested_status` 校验），适配器不生成状态事件。
- `StoredEvent.to_wire()` 永不包含 `tenant_id`。
