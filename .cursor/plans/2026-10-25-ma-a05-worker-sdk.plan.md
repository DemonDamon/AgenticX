# MA-A05 Worker SDK、宿主侧 Work Queue 与 enterprise_worker 协议开关

Planned-with: Claude Opus 5.5
Suggested-Impl-Model: Grok 4.7
Parent: .cursor/plans/2026-10-25-managed-agents-master.plan.md（W1）
Depends-on: MA-00、MA-A01、MA-A02、MA-A03、MA-A04

> 风险等级：高。本子规划修改 `agenticx/runtime/enterprise_worker.py`，该模块在 `agenticx/studio/server.py:74` 被顶层 import → 必须做 `agx serve` 冷启动 smoke（AC NFR-3）。**不修改 `agenticx/studio/server.py`。**

---

## 1. 目标

1. **宿主侧**（加进 MA-A04 的 `agx ma serve`，使 W1 可以在本机端到端测试桌面 Worker 路径）：
   - `desktop_worker` 环境的执行器 `RemoteWorkerExecutor`：会话收到 `user.message` 时生成 Work Item，不在宿主跑循环。
   - Work Queue 存储（SQLite，与 MA-A02 事件库同一文件）。
   - 接口（总规划 6.3）：`work/poll`（长轮询 ≤25 秒）、`work/:id/{ack,heartbeat,complete,fail}`（租约 120 秒、心跳 15 秒、心跳中断 TTL+60 秒后置 `stopped`，不自动转派）、`sessions/:id/events:ingest`（仅 `ma:worker`，服务端分配 seq）、`sessions/:id/inbox/stream`（仅 `ma:worker`，Worker 订阅待处理的用户事件）。
2. **Worker 侧 SDK**（`agenticx/managed/worker/`）：HTTP 客户端 + 远程 `ActionBroker` + 执行器：领取 → 本机装配 Agent 版本（MA-A01）→ 跑 `AgentRuntime` → 事件批量回传 → 心跳 → 完成 / 失败。
3. **桌面接入开关**：`agenticx/runtime/enterprise_worker.py` 增加 `enterprise.worker.protocol: legacy | ma`，默认 `legacy`，`legacy` 行为逐字节不变。
4. CLI `agx ma worker`：不依赖 Near，直接在终端跑一个 Worker，配合 `agx ma serve` 完成 W1 桌面路径演示。

## 2. 根因 / 动机与证据链

- 总规划 4.2：`desktop_worker` 是**全回路自托管**——Worker 在本机跑完整 `AgentRuntime`，agent-runtime 只做会话状态、事件持久化、排队用户消息与分发。时序见总规划 6.4（poll → ack → inbox/stream → 本机执行 → events:ingest → heartbeat → complete）。
- 现状 `agenticx/runtime/enterprise_worker.py`（692 行）：
  - 常量 `HEARTBEAT_INTERVAL_S=15`、`CLAIM_INTERVAL_S=3`、`AUTH_PAUSE_S=60`、`TASK_TIMEOUT_S=8*60`（`:29-35`），设备 id 正则 `_DEVICE_RE = ^[A-Za-z0-9._-]{8,64}$`（`:36`）。
  - `worker_enabled()`（`:46-61`）要求 `enterprise.enabled`、`enterprise.token`、`enterprise.base_url`、`enterprise.worker.enabled` 都有效；`_enterprise_settings()`（`:64-75`）返回 `(token, base_url)`。
  - `EnterpriseWorker.run_once()`（`:306-340`）：到期则 `_heartbeat`（`POST {base}/api/desktop/worker/heartbeat`），再 `_claim`（`POST .../tasks/claim`），领到后 `_execute` → 经本机 Studio `POST /api/chat` SSE 在分身会话里跑（`:577-620`），确认请求一律拒绝（`_deny_confirm` `:622-651`）。
  - 被 `agenticx/studio/server.py:1178-1191` 在 lifespan 里 `asyncio.create_task(enterprise_worker.run_forever())` 启动；`server.py:74` 顶层 `from agenticx.runtime.enterprise_worker import EnterpriseWorker`。
- 旧协议的局限（MA 协议要解决的）：任务只服务协作房间（`room_id` 必填，`:563-575`）；只回传最终文本和工具摘要，不回传事件流；`always_ask` 无法向调用方发起审批（直接拒绝）；不支持自定义工具。
- 现有测试 `tests/test_enterprise_worker.py`（例：`_isolate_config` `:31-34`、`_enable` `:37-42`，用 `ConfigManager.set_value` 设置企业配置）必须保持全绿 → 开关默认 `legacy`。
- 本子规划依赖的上游名字：MA-A02 `SqliteEventStore.connection` / `.lock`（共享连接）、`SessionStateMachine.apply_ingested_status` / `snapshot` / `restore` / `turn_finished`、`KIND_BY_EVENT_TYPE`、`status_running_event` / `status_idle_event` / `session_error_event`、`RuntimeEventAdapter`；MA-A03 `ActionBroker`、`PermissionEngine`、`ManagedPermissionHook`、`ManagedConfirmGate`、`ToolAuthorization`、`CustomToolResolver`；MA-A04 `MAHostState`（`startup_hooks` / `shutdown_hooks` / `extras`）、`SessionService.register_executor_factory` / `actor_for` / `config` / `store` / `event_log` / `registry`、`SessionActor`（`lock`、`sm`、`append`、`sync_record`、`session_id`、`tenant_id`、`record`）、`TurnExecutor`、`content_to_model_text`、`agenticx.managed.sse`（`format_sse`、`PING_FRAME`、`aiter_sse`）、`agenticx.cli.ma_commands.load_fake_llm_script`、`tests/managed/conftest.py` 的 `ma_live_server` / `make_config` / `demo_manifest`。

## 3. In scope / Out of scope

**In scope（只能创建或修改这些文件）：**
- 新建 `agenticx/managed/host/work_queue.py`
- 新建 `agenticx/managed/host/remote_executor.py`
- 新建 `agenticx/managed/host/ingest.py`
- 新建 `agenticx/managed/host/worker_routes.py`
- 修改 `agenticx/managed/host/app.py`：在 `create_ma_app` 里接线（§5.9），只追加，不改已有逻辑
- 新建 `agenticx/managed/worker/__init__.py`
- 新建 `agenticx/managed/worker/client.py`
- 新建 `agenticx/managed/worker/broker.py`
- 新建 `agenticx/managed/worker/runner.py`
- 修改 `agenticx/cli/ma_commands.py`：追加 `worker` 子命令（§5.10）
- 修改 `agenticx/runtime/enterprise_worker.py`：协议开关（§5.11），只增不改既有函数体（唯一例外：`run_once` 中插入两行分支）
- 新建 `tests/managed/test_work_queue.py`
- 新建 `tests/managed/test_worker_routes.py`
- 新建 `tests/managed/test_worker_sdk.py`
- 新建 `tests/managed/test_w1_gate_worker_e2e.py`
- 新建 `tests/test_enterprise_worker_ma_protocol.py`
- 修改 `tests/managed/test_host_api.py`：只改 `test_create_and_get_session` 中关于 `environment_id: "worker"` 的一条断言（§5.9）

**Out of scope：**
- `agenticx/studio/**`（含 `server.py`、`enterprise_worker_routes.py`）零改动；Desktop 设置页「企业 Worker」面板（MA-D01）。
- `worker_keys` 授权（Worker 只能领取命中的环境）：W1 开发宿主上任何带 `ma:worker` 的 token 可领取本租户任一 `desktop_worker` 环境；授权校验在 MA-E03 / MA-D01。
- Worker 用设备 PAT 经企业网关调模型（`desktop:managed`）：MA-D01 / MA-E03。W1 Worker 用本机 provider 配置（`LocalConfigLLMFactory`）。
- Work Item 自动转派、断点续跑。
- Worker 回传预览帧（`event_delta`）：W1 不回传。
- 旧 `enterprise_agent_tasks` 协议的任何改动。

## 4. 数据模型

### 4.1 SQLite 表（与 `ma.sqlite3` 同库，`SqliteWorkQueue` 构造时 `executescript`）

```sql
CREATE TABLE IF NOT EXISTS ma_work_items (
  id                    TEXT PRIMARY KEY,
  tenant_id             TEXT NOT NULL,
  session_id            TEXT NOT NULL REFERENCES ma_sessions(id) ON DELETE CASCADE,
  environment_id        TEXT NOT NULL,
  status                TEXT NOT NULL,          -- queued|claimed|running|completed|failed|stopped
  claimed_by_device     TEXT,
  lease_expires_at      TEXT,                   -- utc_now_iso() format, lexicographically comparable
  attempts              INTEGER NOT NULL DEFAULT 0,
  last_heartbeat_at     TEXT,
  inbox_after_seq       INTEGER NOT NULL DEFAULT 0,
  consumed_through_seq  INTEGER,
  error                 TEXT,
  created_at            TEXT NOT NULL,
  updated_at            TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_ma_work_env_status ON ma_work_items(tenant_id, environment_id, status, created_at);
CREATE INDEX IF NOT EXISTS ix_ma_work_session ON ma_work_items(session_id, created_at);
```

`inbox_after_seq`：该 Work Item 的 inbox 从哪个 seq 之后开始投递。`consumed_through_seq`：结束时 Worker 已处理到的 seq（`completed` 由 Worker 上报；`failed` / `stopped` 由宿主置为当时的 `last_seq`，即丢弃未处理的消息，不转派）。

### 4.2 Wire 形状

`WorkItemRecord`（MA-00，`extra="forbid"`）只含 `id, session_id, environment_id, status, claimed_by_device, lease_expires_at, attempts, last_heartbeat_at`。额外字段放在包装对象里：

```json
// POST /ma/v1/environments/{environment_id}/work/poll  -> 200
{
  "work": { ...WorkItemRecord } | null,
  "session": { ...SessionRecord } ,            // present iff work != null
  "agent": {"agent_id": "demo", "version": 1, "manifest": { ...normalized manifest } },
  "inbox_after_seq": 0
}
// ack / heartbeat / complete / fail -> 200
{ "work": { ...WorkItemRecord } }
// events:ingest -> 200
{ "events": [ ...stored wire events ] }
```

请求体（pydantic `extra="forbid"`，校验失败 → 400 `invalid_request`）：

| 接口 | 请求体 |
|------|--------|
| poll | `{"device_id": str, "max_wait_seconds": int = 25}`（0..25） |
| ack / heartbeat | `{"device_id": str}` |
| complete | `{"device_id": str, "consumed_through_seq": int}`（≥0） |
| fail | `{"device_id": str, "error": str}`（1..2000 字符；宿主截断到 500 存储） |
| events:ingest | `{"work_id": str, "device_id": str, "events": [object, ...]}`（1..100） |

`device_id` 必须匹配 `^[A-Za-z0-9._-]{8,64}$`（与 `enterprise_worker._DEVICE_RE` 相同），否则 400。inbox 的 query：`work_id`、`device_id`（同正则）、`after_seq`（int ≥0，可选）。

所有接口 scope 为 `ma:worker`（`require_scope`，`ma:admin` 亦可）。

## 5. 精确落点

文件头、英文注释、绝对 import、import 置顶（同 MA-A01 §4）。

### 5.1 `agenticx/managed/host/work_queue.py`

```python
ACTIVE_STATUSES = ("queued", "claimed", "running")
LEASED_STATUSES = ("claimed", "running")
TERMINAL_STATUSES = ("completed", "failed", "stopped")

@dataclass(frozen=True)
class WorkItemRow:
    id: str; tenant_id: str; session_id: str; environment_id: str; status: WorkItemStatus
    claimed_by_device: str | None; lease_expires_at: str | None; attempts: int
    last_heartbeat_at: str | None; inbox_after_seq: int; consumed_through_seq: int | None
    error: str | None; created_at: str; updated_at: str
    def to_record(self) -> WorkItemRecord: ...

class SqliteWorkQueue:
    def __init__(self, store: SqliteEventStore, *, clock: Callable[[], datetime] = lambda: datetime.now(timezone.utc)) -> None: ...
    def notify(self, environment_id: str) -> None: ...
    async def wait_for_work(self, environment_id: str, timeout: float) -> None: ...
    def create(self, *, tenant_id: str, session_id: str, environment_id: str, inbox_after_seq: int) -> WorkItemRow: ...
    def get(self, tenant_id: str, work_id: str) -> WorkItemRow | None: ...
    def active_for_session(self, tenant_id: str, session_id: str) -> WorkItemRow | None: ...
    def claim_next(self, tenant_id: str, environment_id: str, device_id: str) -> WorkItemRow | None: ...
    def require_lease(self, tenant_id: str, work_id: str, device_id: str, *, statuses: Sequence[str]) -> WorkItemRow: ...
    def ack(self, tenant_id: str, work_id: str, device_id: str) -> WorkItemRow: ...
    def heartbeat(self, tenant_id: str, work_id: str, device_id: str) -> WorkItemRow: ...
    def complete(self, tenant_id: str, work_id: str, device_id: str, consumed_through_seq: int) -> WorkItemRow: ...
    def finish(self, tenant_id: str, work_id: str, *, status: Literal["failed", "stopped"],
               error: str, consumed_through_seq: int) -> WorkItemRow: ...
    def expired(self) -> list[WorkItemRow]: ...
    def leased_items(self) -> list[WorkItemRow]: ...
```

规则（全部在 `with store.lock:` 内用 `store.connection` 同步执行）：
- 时间一律 `utc_now_iso(self._clock())`；租约到期 = now + `WORK_LEASE_TTL_SECONDS`（120）。
- `create`：`id=new_ulid()`，`status="queued"`，`attempts=0`；随后调用方负责 `notify(environment_id)`。
- `claim_next`：`SELECT id FROM ma_work_items WHERE tenant_id=? AND environment_id=? AND status='queued' ORDER BY created_at, id LIMIT 1`；然后 `UPDATE ... SET status='claimed', claimed_by_device=?, lease_expires_at=?, attempts=attempts+1, last_heartbeat_at=?, updated_at=? WHERE id=? AND status='queued'`；`rowcount != 1` → 返回 None（被别人抢走）。
- `require_lease(work_id, device_id, statuses)`：行不存在、`claimed_by_device != device_id`、`status not in statuses`、或 `lease_expires_at < now` → `MAError(WORK_LEASE_LOST, "work lease lost", details={"work_id": work_id})`（409）。
- `ack`：`require_lease(statuses=("claimed",))` → `status='running'`，续约。
- `heartbeat`：`require_lease(statuses=LEASED_STATUSES)` → 续约、`last_heartbeat_at=now`。
- `complete`：`require_lease(statuses=("running",))`；`consumed_through_seq < row.inbox_after_seq` → `MAError(INVALID_REQUEST, "consumed_through_seq is behind inbox_after_seq")`；`status='completed'`、`consumed_through_seq=?`。
- `finish(status, error, consumed_through_seq)`：不校验租约，直接置终态（宿主内部用于 fail / 过期 / 归档）。
- `expired()`：`status IN ('claimed','running') AND lease_expires_at < utc_now_iso(now - WORK_STOP_GRACE_SECONDS)`（60 秒宽限）。
- `leased_items()`：`status IN ('claimed','running')`。
- `notify` / `wait_for_work`：每个环境一个 `asyncio.Event`（惰性创建）；`notify` 置位；`wait_for_work` 在 `timeout` 内等待置位后 `clear()`，超时静默返回。

### 5.2 `agenticx/managed/host/remote_executor.py`

```python
class RemoteWorkerExecutor:                                  # implements MA-A04 TurnExecutor
    def __init__(self, actor: SessionActor, work_queue: SqliteWorkQueue) -> None: ...
    async def submit_message(self, message: StoredEvent) -> None:
        if self._queue.active_for_session(actor.tenant_id, actor.session_id) is None:
            self._queue.create(tenant_id=..., session_id=..., environment_id=actor.environment.id,
                               inbox_after_seq=message.seq - 1)
            self._queue.notify(actor.environment.id)
    async def on_resolved(self, resolutions) -> None: return None      # delivered to the worker via inbox
    async def interrupt(self, dropped_pending) -> None: return None    # delivered to the worker via inbox
    async def close(self) -> None:
        item = self._queue.active_for_session(...)
        if item is not None:
            self._queue.finish(item.tenant_id, item.id, status="stopped", error="session archived",
                               consumed_through_seq=await store.last_seq(...))
```

注意：远程执行时，宿主状态机的 `idle → running` 不在 `submit_message` 里发生，而是在 Worker 回传 `session.status_running` 时经 `apply_ingested_status` 发生（MA-A02 §4.5）。所有 resolution / 中断照常由 MA-A04 `handle_client_batch` 落库与提交；全部 resolution 到齐时宿主自己追加 `session.status_running`（MA-A02 `commit`），**Worker 不得再回传该事件**。

### 5.3 `agenticx/managed/host/ingest.py`

```python
MAX_INGEST_EVENTS = 100
INGEST_STRIP_KEYS = ("session_id", "seq", "created_at", "processed_at")

async def ingest_worker_events(actor: SessionActor, work_queue: SqliteWorkQueue, *,
                               work_id: str, device_id: str, raw_events: Any) -> list[StoredEvent]: ...
async def complete_work(actor: SessionActor, work_queue: SqliteWorkQueue, *,
                        work_id: str, device_id: str, consumed_through_seq: int) -> WorkItemRow: ...
async def fail_work(actor: SessionActor, work_queue: SqliteWorkQueue, *,
                    work_id: str, device_id: str, error: str) -> WorkItemRow: ...
async def stop_expired_work(service: SessionService, work_queue: SqliteWorkQueue) -> int: ...
```

**`ingest_worker_events`：**

```python
item = work_queue.require_lease(actor.tenant_id, work_id, device_id, statuses=("running",))
if item.session_id != actor.session_id:
    raise MAError(WORK_LEASE_LOST, "work lease lost", details={"work_id": work_id})
if not isinstance(raw_events, list) or not 1 <= len(raw_events) <= MAX_INGEST_EVENTS:
    raise MAError(INVALID_EVENT_BATCH, "events must contain 1-100 items")
cleaned = []
for i, ev in enumerate(raw_events):
    if not isinstance(ev, dict) or ev.get("type") not in SERVER_EVENT_TYPES:
        raise MAError(INVALID_EVENT_BATCH, f"events[{i}]: workers may only ingest server events", details={"index": i})
    body = {k: v for k, v in ev.items() if k not in INGEST_STRIP_KEYS}
    try:
        parse_server_event(dict(body))
    except Exception:
        raise MAError(INVALID_EVENT_BATCH, f"events[{i}]: invalid", details={"index": i})
    cleaned.append(body)
batch_types = {e["id"]: e["type"] for e in cleaned if isinstance(e.get("id"), str)}
async with actor.lock:
    snap = actor.sm.snapshot()
    last_usage = None
    try:
        for ev in cleaned:
            t = ev["type"]
            if t.startswith("session.status_"):
                kinds = {}
                sr = ev.get("stop_reason") or {}
                if t == "session.status_idle" and sr.get("type") == "requires_action":
                    for eid in sr.get("event_ids") or []:
                        et = batch_types.get(eid)
                        if et is None:
                            stored = await actor.service.store.get_event(actor.tenant_id, actor.session_id, eid)
                            et = stored.type if stored else None
                        kind = KIND_BY_EVENT_TYPE.get(et or "")
                        if kind is not None:
                            kinds[eid] = kind
                actor.sm.apply_ingested_status(ev, kinds)
            elif t == "session.usage":
                last_usage = Usage.model_validate(ev["usage"])
        stored = await actor.append(cleaned)
    except BaseException:
        actor.sm.restore(snap)
        raise
    await actor.sync_record(usage=last_usage)
return stored
```

**`complete_work`：**

```python
leased = work_queue.require_lease(actor.tenant_id, work_id, device_id, statuses=("running",))
if leased.session_id != actor.session_id:
    raise MAError(WORK_LEASE_LOST, "work lease lost", details={"work_id": work_id})
async with actor.lock:
    row = work_queue.complete(actor.tenant_id, work_id, device_id, consumed_through_seq)
    if actor.sm.status == "running" or actor.sm.requires_action:
        await actor.append([session_error_event("worker_incomplete",
            "worker completed the work item while the session was still active", "exhausted")])
        await actor.append(actor.sm.turn_finished("retries_exhausted"))
        await actor.sync_record()
    pending = await actor.service.store.list_events(actor.tenant_id, actor.session_id,
                                                    after_seq=consumed_through_seq, limit=1, types=["user.message"])
    if pending:
        work_queue.create(tenant_id=actor.tenant_id, session_id=actor.session_id,
                          environment_id=row.environment_id, inbox_after_seq=consumed_through_seq)
        work_queue.notify(row.environment_id)
return row
```
**`fail_work`：** `require_lease(statuses=LEASED_STATUSES)` 且 session 匹配；`message = redact_text(error)[:500]`（`agenticx.runtime.credential_store.redact_text`）；锁内：`row = work_queue.finish(..., status="failed", error=message, consumed_through_seq=await store.last_seq(...))`；`append([session_error_event("worker_failed", message, "exhausted")])`；若 running / requires_action → `append(sm.turn_finished("retries_exhausted"))`；`sync_record()`。

**`stop_expired_work(service, work_queue)`：** 对 `work_queue.expired()` 的每一项：`actor = await service.actor_for(item.tenant_id, item.session_id)`；锁内：`finish(status="stopped", error="worker heartbeat lost", consumed_through_seq=last_seq)`；`append([session_error_event("worker_lost", "worker heartbeat lost; the work item was stopped", "exhausted")])`；若 running / requires_action → `turn_finished("retries_exhausted")`；`sync_record()`。返回处理条数。会话或 Agent 已不存在（`actor_for` 抛 `MAError`）→ 只 `finish` 不写事件。

### 5.4 `agenticx/managed/host/worker_routes.py`

```python
def build_worker_router(state: MAHostState, work_queue: SqliteWorkQueue) -> APIRouter: ...
```

| 方法 | 路径 | 处理 |
|------|------|------|
| POST | `/ma/v1/environments/{environment_id}/work/poll` | `env = registry.get_environment(tenant, environment_id)` → None → 404 `environment_not_found`；`env.type != "desktop_worker"` → 400 `invalid_request`；循环：`row = claim_next(...)`，有则组装响应（`session = store.get_session`；`ver = registry.get_version(tenant, session.agent_id, session.agent_version)`；`agent = {"agent_id": session.agent_id, "version": ver.version, "manifest": ver.manifest}`；`inbox_after_seq = row.inbox_after_seq`）返回；无则 `await wait_for_work(env_id, remaining)` 直到 `max_wait_seconds` 用完，返回 `{"work": null}` |
| POST | `/ma/v1/work/{work_id}/ack` | `work_queue.ack(...)` → `{"work": row.to_record().model_dump(mode="json")}` |
| POST | `/ma/v1/work/{work_id}/heartbeat` | `work_queue.heartbeat(...)` → 同上 |
| POST | `/ma/v1/work/{work_id}/complete` | `row = work_queue.get(tenant, work_id)` → None → 409 `work_lease_lost`；`actor = service.actor_for(tenant, row.session_id)`；`complete_work(...)` |
| POST | `/ma/v1/work/{work_id}/fail` | 同上取 actor；`fail_work(...)` |
| POST | `/ma/v1/sessions/{session_id}/events:ingest` | `actor = service.actor_for(tenant, session_id)`；`ingest_worker_events(...)` → `{"events": [s.to_wire() for s in stored]}` |
| GET | `/ma/v1/sessions/{session_id}/inbox/stream` | 见下 |

`tenant` 一律取 `principal.tenant_id`。

**inbox 流算法：**

```python
item = work_queue.require_lease(tenant, work_id, device_id, statuses=LEASED_STATUSES)
if item.session_id != session_id: raise MAError(WORK_LEASE_LOST, ...)
cursor = max(after_seq or 0, item.inbox_after_seq)
sub = event_log.broadcaster.subscribe(session_id)                    # subscribe before replay
async def gen():
    nonlocal cursor
    try:
        while True:
            rows = await store.list_events(tenant, session_id, after_seq=cursor, limit=500,
                                           types=list(CLIENT_EVENT_TYPES))
            for r in rows:
                await store.mark_processed(tenant, session_id, [r.id], utc_now_iso())
                yield format_sse(id=r.seq, event=r.type, data=r.to_wire()); cursor = r.seq
            if len(rows) < 500: break
        while True:
            if sub.overflowed or await request.is_disconnected(): return
            try:
                bitem = await asyncio.wait_for(sub.queue.get(), timeout=config.sse_ping_seconds)
            except asyncio.TimeoutError:
                current = work_queue.get(tenant, work_id)
                if current is None or current.status not in LEASED_STATUSES: return
                yield PING_FRAME; continue
            if bitem.kind == "close": return
            if bitem.kind != "event" or bitem.event.type not in CLIENT_EVENT_TYPES: continue
            if bitem.event.seq <= cursor: continue
            await store.mark_processed(tenant, session_id, [bitem.event.id], utc_now_iso())
            yield format_sse(id=bitem.event.seq, event=bitem.event.type, data=bitem.event.to_wire())
            cursor = bitem.event.seq
    finally:
        sub.close()
return StreamingResponse(gen(), media_type="text/event-stream", headers={"Cache-Control": "no-cache"})
```

（inbox 只投递客户端事件，所以 seq 不连续是正常的，不做 gap 回填。）

### 5.5 `agenticx/managed/worker/client.py`

```python
class MAWorkerError(Exception):
    def __init__(self, status: int, code: str, message: str) -> None: ...
class WorkLeaseLostError(MAWorkerError): ...      # HTTP 409 with code work_lease_lost
class WorkerAuthError(MAWorkerError): ...         # HTTP 401 / 403

@dataclass(frozen=True)
class WorkAssignment:
    work: WorkItemRecord
    session: SessionRecord
    agent_id: str
    agent_version: int
    manifest: dict[str, Any]
    inbox_after_seq: int

class MAWorkerClient:
    def __init__(self, base_url: str, token: str, *, http: httpx.AsyncClient | None = None) -> None: ...
    async def poll(self, environment_id: str, device_id: str, *, max_wait_seconds: int = WORK_POLL_MAX_WAIT_SECONDS) -> WorkAssignment | None: ...
    async def ack(self, work_id: str, device_id: str) -> WorkItemRecord: ...
    async def heartbeat(self, work_id: str, device_id: str) -> WorkItemRecord: ...
    async def complete(self, work_id: str, device_id: str, consumed_through_seq: int) -> WorkItemRecord: ...
    async def fail(self, work_id: str, device_id: str, error: str) -> WorkItemRecord: ...
    async def ingest(self, session_id: str, work_id: str, device_id: str, events: Sequence[Mapping[str, Any]]) -> list[dict[str, Any]]: ...
    async def list_events(self, session_id: str, *, after_seq: int = 0, limit: int = 500, types: Sequence[str] = ()) -> tuple[list[dict[str, Any]], bool]: ...
    async def inbox(self, session_id: str, work_id: str, device_id: str, *, after_seq: int) -> AsyncIterator[dict[str, Any]]: ...
    async def aclose(self) -> None: ...
```

- URL：`f"{base_url.rstrip('/')}/ma/v1/..."`；header `Authorization: Bearer <token>`；自建的 `httpx.AsyncClient(trust_env=False, timeout=httpx.Timeout(60.0, connect=10.0))`（`trust_env=False` 与 `enterprise_worker._client()` `:342-345` 一致）；poll 的读超时 = `max_wait_seconds + 15`。
- 非 2xx：解析 `{"error": {"code", "message"}}`；401 / 403 → `WorkerAuthError`；409 且 code `work_lease_lost` → `WorkLeaseLostError`；其他 → `MAWorkerError`。错误消息里不得包含 token。
- `inbox`：`client.stream("GET", url, params=...)` + `aiter_sse(response.aiter_lines())`，逐条 `yield msg.json()`（wire dict，含 `seq`）。
- 传入外部 `http` 时 `aclose()` 不关闭它。

### 5.6 `agenticx/managed/worker/broker.py`

```python
class IngestSink:
    def __init__(self, client: MAWorkerClient, *, session_id: str, work_id: str, device_id: str,
                 flush_interval: float = 0.5, max_batch: int = 20) -> None: ...
    async def start(self) -> None: ...                          # starts the periodic flush task
    async def emit(self, events: Sequence[Mapping[str, Any]], *, flush: bool = False) -> None: ...
    async def flush(self) -> None: ...                          # serialized by an asyncio.Lock; chunks of <= 100
    async def close(self) -> None: ...                          # final flush + cancel periodic task


class RemoteActionBroker:                                       # implements agenticx.managed.actions.ActionBroker
    def __init__(self, *, sink: IngestSink, adapter: RuntimeEventAdapter) -> None: ...
    async def announce_tool_use(self, *, kind, name, input, evaluated_policy, mcp_server=None) -> str:
        events = self._adapter.build_tool_use(kind=kind, name=name, input=input,
                                              evaluated_policy=evaluated_policy, mcp_server=mcp_server)
        await self._sink.emit(events, flush=True)
        return events[-1]["id"]
    async def request_action(self, event_id: str, kind: ActionKind) -> ClientEvent | None:
        if self._voided:                     # interrupt arrived before the hook asked: do not park
            return None
        fut = asyncio.get_running_loop().create_future()
        self._waiters[event_id] = (kind, fut)
        try:
            await self._sink.emit([status_idle_event("requires_action", [event_id])], flush=True)
            return await fut
        finally:
            self._waiters.pop(event_id, None)
    def custom_tool_use_id(self, name: str) -> str | None:
        return self._adapter.ledger.inflight_custom(name)
    def deliver(self, event: ClientEvent) -> bool:
        """Resolve the matching waiter (tool_use_id / custom_tool_use_id with the same kind). Unknown ids -> False."""
    def void_all(self) -> None: ...          # sets self._voided = True and resolves every waiter with None
    def reset(self) -> None: ...             # sets self._voided = False; runner calls it at each turn start
```

`_voided` 初始为 False。

`flush()` 失败：`WorkLeaseLostError` 原样上抛（runner 会停止）；其他异常重试 3 次（间隔 1 秒），仍失败则上抛。

### 5.7 `agenticx/managed/worker/runner.py`

```python
IDLE_COMPLETE_SECONDS = 2.0

class WorkItemRunner:
    def __init__(self, *, client: MAWorkerClient, device_id: str, llm_factory: LLMFactory, workdir_root: Path,
                 enterprise_policy_loader: Callable[[], EnterpriseAgentPolicy] = EnterpriseAgentPolicy,
                 heartbeat_interval: float = float(WORK_HEARTBEAT_INTERVAL_SECONDS),
                 idle_complete_seconds: float = IDLE_COMPLETE_SECONDS) -> None: ...
    async def run(self, assignment: WorkAssignment) -> None: ...


class MAWorker:
    def __init__(self, *, client: MAWorkerClient, environment_ids: Sequence[str], device_id: str,
                 runner: WorkItemRunner) -> None: ...
    async def run_once(self, *, max_wait_seconds: int = 0) -> bool: ...
    async def run_forever(self, *, stop: asyncio.Event | None = None) -> None: ...
```

**`WorkItemRunner.run(a)`：**

```text
work_id, sid = a.work.id, a.session.id
await client.ack(work_id, device_id)
try:
    spec = compile_spec(a.agent_id, a.agent_version, a.manifest)
except MAError as err:
    await client.fail(work_id, device_id, "manifest invalid: " + "; ".join(err.details.get("errors", [])))
    return
history = all wire events of types user.message/agent.message with seq <= a.inbox_after_seq
          (page client.list_events(sid, after_seq=cursor, limit=500, types=[...]) until has_more is False)
adapter = RuntimeEventAdapter(model_ref=spec.model_ref, kind_of=spec.kind_of)
sink = IngestSink(client, session_id=sid, work_id=work_id, device_id=device_id); await sink.start()
broker = RemoteActionBroker(sink=sink, adapter=adapter)
auth = ToolAuthorization()
engine = PermissionEngine(spec, enterprise_policy_loader())
bundle = ManagedAgentBuilder(llm_factory=llm_factory, workdir_root=workdir_root).build(
    spec,
    context=LLMCallContext(tenant_id=a.session.tenant_id, session_id=sid, agent_id=a.agent_id,
                           agent_version=a.agent_version, user_id=a.session.created_by_user_id),
    confirm_gate=ManagedConfirmGate(auth),
    hooks=[ManagedPermissionHook(engine=engine, broker=broker, authorization=auth)],
    custom_tool_resolver=CustomToolResolver(broker=broker, custom_tool_names=spec.custom_tool_names),
    history=rehydrate_agent_messages(history),
)
state: turn_running=False, stop_requested=False, lease_lost=False, last_inbox_seq=a.inbox_after_seq,
       queue: asyncio.Queue[dict], usage = a.session.usage

heartbeat task: every heartbeat_interval -> client.heartbeat; WorkLeaseLostError -> lease_lost=True,
                stop_requested=True, broker.void_all(), return
inbox task: loop while not done:
    async for ev in client.inbox(sid, work_id, device_id, after_seq=last_inbox_seq):
        last_inbox_seq = max(last_inbox_seq, ev["seq"])
        user.message            -> queue.put(ev)
        user.tool_confirmation / user.custom_tool_result -> broker.deliver(parse_client_events({"events":[ev]})[0])
        user.interrupt          -> if turn_running: stop_requested=True; broker.void_all()   (ignored when idle)
    on WorkLeaseLostError: lease_lost=True; stop_requested=True; broker.void_all(); return
    on other exception: await asyncio.sleep(1.0) and reconnect with after_seq=last_inbox_seq

turn loop:
    while not lease_lost:
        try: msg = await asyncio.wait_for(queue.get(), timeout=idle_complete_seconds)
        except TimeoutError: break
        text, unsupported = content_to_model_text(msg.get("content") or [])
        stop_requested = False; turn_running = True; broker.reset()
        await sink.emit([status_running_event()], flush=True)
        if unsupported: await sink.emit([session_error_event("unsupported_content",
                                         "image and file content blocks are ignored by this worker", "exhausted")])
        adapter.begin_turn(usage)
        try:
            async for ev in bundle.run_turn(text, should_stop=lambda: stop_requested):
                out = adapter.convert(ev)
                if out.events: await sink.emit(out.events)
            outcome = adapter.finish_turn()
        except WorkLeaseLostError: lease_lost = True; break
        except Exception as exc: outcome = adapter.finish_turn(error=exc)
        usage = outcome.usage; turn_running = False
        await sink.emit(outcome.events + [status_idle_event(outcome.stop_type)], flush=True)
finally-ish:
    cancel heartbeat + inbox tasks; await sink.close() unless lease_lost
    if lease_lost: return                                   # host will stop the item; never complete
    await client.complete(work_id, device_id, consumed_through_seq=last_inbox_seq)
any unexpected exception after ack (outside the per-turn try) -> client.fail(work_id, device_id, f"{type(exc).__name__}: {exc}"[:500]) (swallow errors of fail itself, log warning)
```

说明：
- `status_running_event` / `status_idle_event` / `session_error_event` 来自 MA-A02；Worker 回传的状态事件经宿主 `apply_ingested_status` 校验。
- `requires_action` 由 `RemoteActionBroker.request_action` 回传；resolution 到齐后宿主自己写 `session.status_running`，Worker 只继续执行。
- 完成条件：本机队列空闲 `idle_complete_seconds` 秒且无回合在跑。上报 `consumed_through_seq=last_inbox_seq`；宿主发现其后仍有 `user.message` 会自动建新 Work Item（§5.3）。

**`MAWorker.run_once(max_wait_seconds)`**：按顺序对每个环境 `poll`；第一个拿到的 assignment 交给 `runner.run` 并返回 True；都没有返回 False。`WorkerAuthError` 上抛（调用方处理暂停）。
**`run_forever(stop)`**：循环 `run_once(max_wait_seconds=WORK_POLL_MAX_WAIT_SECONDS)`；`MAWorkerError` / 网络错误记录 warning 后 `sleep(3)`；`stop` 置位则退出。

### 5.8 `agenticx/managed/worker/__init__.py`

re-export：`MAWorkerClient`、`MAWorkerError`、`WorkLeaseLostError`、`WorkerAuthError`、`WorkAssignment`、`IngestSink`、`RemoteActionBroker`、`WorkItemRunner`、`MAWorker`。

### 5.9 `agenticx/managed/host/app.py` 接线（只追加）

`app.py` 顶部 import 区追加：`import asyncio`、`import logging`（若尚无）、`from agenticx.managed.host.ingest import stop_expired_work`、`from agenticx.managed.host.remote_executor import RemoteWorkerExecutor`、`from agenticx.managed.host.work_queue import SqliteWorkQueue`、`from agenticx.managed.host.worker_routes import build_worker_router`，以及从 `agenticx.managed.protocol` 追加 `WORK_HEARTBEAT_INTERVAL_SECONDS`；模块级 `logger = logging.getLogger(__name__)`（若尚无）。

在 `create_ma_app` 中、`app.include_router(build_session_router(state))` 之后追加：

```python
if isinstance(store, SqliteEventStore):
    work_queue = SqliteWorkQueue(store)
    state.extras["work_queue"] = work_queue
    service.register_executor_factory("desktop_worker", lambda actor: RemoteWorkerExecutor(actor, work_queue))
    app.include_router(build_worker_router(state, work_queue))

    async def _stop_stale_leases_on_startup() -> None:
        for item in work_queue.leased_items():
            work_queue.finish(item.tenant_id, item.id, status="stopped", error="host restarted",
                              consumed_through_seq=await store.last_seq(item.tenant_id, item.session_id))

    async def _start_sweeper() -> None:
        async def _loop() -> None:
            while True:
                await asyncio.sleep(WORK_HEARTBEAT_INTERVAL_SECONDS)
                try:
                    await stop_expired_work(service, work_queue)
                except Exception:
                    logger.exception("work lease sweeper failed")
        state.extras["work_sweeper"] = asyncio.create_task(_loop())

    async def _stop_sweeper() -> None:
        task = state.extras.pop("work_sweeper", None)
        if task is not None:
            task.cancel()

    state.startup_hooks.extend([_stop_stale_leases_on_startup, _start_sweeper])
    state.shutdown_hooks.append(_stop_sweeper)
```

（非 SQLite 存储时不接线：PG 版 Work Queue 由 MA-E03 提供。）

Before：创建 `environment_id="worker"` 的会话返回 400（MA-A04 FR-5）。After：可创建，消息进入 Work Queue。因此 MA-A04 的 `tests/managed/test_host_api.py::test_create_and_get_session` 中「`environment_id: "worker"` → 400」那一条断言必须改为 `assert app.state.ma.service.supports_environment("desktop_worker")`——这是本子规划对 MA-A04 测试的唯一改动（见 §6 FR-1）。

### 5.10 `agenticx/cli/ma_commands.py` 追加 `worker` 子命令

```python
@ma_app.command("worker")
def worker(
    base_url: str = typer.Option("http://127.0.0.1:8092", "--base-url"),
    token: str = typer.Option("", "--token", help="Bearer token with ma:worker scope; default $AGX_MA_DEV_TOKEN"),
    environment: list[str] = typer.Option(["worker"], "--environment", "-e"),
    device_id: str = typer.Option("", "--device-id", help="Default: ma-dev-<random hex>"),
    once: bool = typer.Option(False, "--once", help="Handle at most one work item, then exit"),
    data_dir: Optional[Path] = typer.Option(None, "--data-dir", help="Default: ~/.agenticx/ma-worker"),
    fake_llm: Optional[Path] = typer.Option(None, "--fake-llm"),
) -> None: ...
```

逻辑：token 为空且环境变量也空 → 打印错误 `raise typer.Exit(2)`；`device_id = device_id or f"ma-dev-{secrets.token_hex(8)}"`，不匹配设备正则 → Exit 2；`llm_factory = PerSessionScriptFactory(...)`（`--fake-llm`，用 `load_fake_llm_script`）否则 `LocalConfigLLMFactory()`；`runner = WorkItemRunner(client=..., device_id=..., llm_factory=..., workdir_root=(data_dir or agx_home()/"ma-worker")/"sessions")`；`--once` → `asyncio.run(worker.run_once(max_wait_seconds=WORK_POLL_MAX_WAIT_SECONDS))`，否则 `asyncio.run(worker.run_forever())`。`agenticx.managed.*` 在命令体内 import（与 `serve` 相同惯例与注释）。

### 5.11 `agenticx/runtime/enterprise_worker.py` 协议开关

**新增（模块级）：**

```python
MA_ENV_MISSING = "未配置 MA 工作环境"
_WORKER_PROTOCOLS = ("legacy", "ma")


def worker_protocol() -> str:
    """'ma' only when enterprise.worker.protocol is exactly 'ma' (case-insensitive); otherwise 'legacy'."""
    try:
        raw = ConfigManager.get_value("enterprise.worker.protocol")
    except Exception:
        return "legacy"
    return "ma" if isinstance(raw, str) and raw.strip().lower() == "ma" else "legacy"


def _ma_environment_ids() -> list[str]:
    """enterprise.worker.ma_environment_ids: list of non-empty strings (deduplicated, order kept)."""


def _ma_base_url(default_base: str) -> str:
    """enterprise.worker.ma_base_url when it is a non-empty string, else default_base; trailing '/' stripped."""
```

顶部 import 区追加（放在现有 `from agenticx.utils.agx_home import agx_home` 之后）：

```python
from agenticx.managed.llm import LocalConfigLLMFactory
from agenticx.managed.worker.client import MAWorkerClient, WorkerAuthError
from agenticx.managed.worker.runner import MAWorker, WorkItemRunner
from agenticx.runtime.enterprise_agent_policy import load_enterprise_agent_policy
```

**`EnterpriseWorker.__init__`** 末尾追加两行：`self._ma_worker: MAWorker | None = None`、`self._ma_worker_key: tuple[str, str, tuple[str, ...]] | None = None`。

**`EnterpriseWorker.run_once`**（`:306-340`）：在 `token, base = settings`（`:312`）之后**插入**：

```python
        if worker_protocol() == "ma":
            return await self._run_once_ma(token, base)
```

其余行不动。Before：总是走 legacy heartbeat + claim。After：`protocol == "ma"` 时走 MA，否则与改动前完全相同。

**新增方法：**

```python
    def _ma_worker_for(self, token: str, base: str, env_ids: list[str]) -> MAWorker:
        key = (token, _ma_base_url(base), tuple(env_ids))
        if self._ma_worker is None or self._ma_worker_key != key:
            client = MAWorkerClient(_ma_base_url(base), token, http=self._client())
            device_id = self._ensure_device_id()
            runner = WorkItemRunner(
                client=client,
                device_id=device_id,
                llm_factory=LocalConfigLLMFactory(),
                workdir_root=_state_dir() / "ma_sessions",
                enterprise_policy_loader=load_enterprise_agent_policy,
            )
            self._ma_worker = MAWorker(client=client, environment_ids=env_ids, device_id=device_id, runner=runner)
            self._ma_worker_key = key
        return self._ma_worker

    async def _run_once_ma(self, token: str, base: str) -> bool:
        env_ids = _ma_environment_ids()
        if not env_ids:
            self._last_error = MA_ENV_MISSING
            return False
        if time.monotonic() < self._claim_pause_until:
            return False
        worker = self._ma_worker_for(token, base, env_ids)
        try:
            handled = await worker.run_once(max_wait_seconds=0)
        except WorkerAuthError:
            self._pause_for_auth()
            return False
        if handled and self._last_error in (MA_ENV_MISSING, AUTH_ERROR):
            self._last_error = None
        return handled
```

`run_forever`（`:278-304`）无需改：MA 模式下 `run_once` 返回 False 时同样 `sleep(CLAIM_INTERVAL_S)`。

**配置键（写入 `~/.agenticx/config.yaml`，均可缺省）：**

| 键 | 类型 | 默认 | 说明 |
|----|------|------|------|
| `enterprise.worker.protocol` | `legacy` \| `ma` | `legacy` | 其他值一律视为 `legacy` |
| `enterprise.worker.ma_base_url` | str | `enterprise.base_url` | MA 会话面根地址（W1 本机演示填 `http://127.0.0.1:8092`） |
| `enterprise.worker.ma_environment_ids` | list[str] | `[]` | 要领取的 `desktop_worker` 环境 id；为空时 MA 模式不领取并报 `MA_ENV_MISSING` |

`worker_enabled()` 不变：MA 模式同样要求 `enterprise.enabled` / `token` / `base_url` / `worker.enabled`。

## 6. FR / NFR / AC

宿主侧测试用 `tests/managed/conftest.py` 的 `make_config` + `ma_live_server`（MA-A04 §6.1）；Worker 用 `MAWorkerClient(base_url, token, http=httpx.AsyncClient(trust_env=False, timeout=30))`；LLM 用 `PerSessionScriptFactory`；`heartbeat_interval` / `idle_complete_seconds` 在测试中调小（0.5 / 0.5）。

| ID | 内容 | AC（文件 :: 函数 → 断言） |
|----|------|------|
| FR-1 | desktop_worker 环境可用 | `test_worker_routes.py::test_worker_environment_sessions_enqueue_work`：创建 `environment_id="worker"` 会话 → 201；POST user.message → `work_queue.active_for_session(...)` 为 queued，`inbox_after_seq == 0`；会话 `status` 仍为 `idle`（等待 Worker 回传 running）。同时把 `tests/managed/test_host_api.py::test_create_and_get_session` 中 `environment_id: "worker"` → 400 的那一条断言改为 `assert app.state.ma.service.supports_environment("desktop_worker")`（唯一允许修改的 A04 测试行） |
| FR-2 | 领取 CAS 与长轮询 | `test_work_queue.py::test_claim_next_is_exclusive`：一个 queued 项，两个设备先后 `claim_next` → 只有第一个拿到，`attempts == 1`、`status == "claimed"`；`test_worker_routes.py::test_poll_long_wait_returns_null`：无任务 `max_wait_seconds=1` → 约 1 秒后 200 `{"work": null}`（耗时 ≥0.9s 且 <5s）；`test_worker_routes.py::test_poll_wakes_on_new_work`：先发起 `max_wait_seconds=10` 的 poll，0.3 秒后另一请求发消息 → poll 在 3 秒内返回该项，响应含 `session.id`、`agent.version == 1`、`agent.manifest["schema"] == "agx.agent/v1"`、`inbox_after_seq == 0` |
| FR-3 | 环境校验与 scope | `test_worker_routes.py::test_poll_validation_and_scope`：`environments/local/work/poll`（cloud）→ 400；未知环境 → 404 `environment_not_found`；`device_id: "x"` → 400；只有 `ma:sessions:read` 的 token → 403 `forbidden_scope` |
| FR-4 | 租约规则 | `test_work_queue.py::test_lease_rules`（注入可控 clock）：ack 前 heartbeat 允许（claimed）；他人 device ack → `MAError` `work_lease_lost`；ack 后 status running；clock 前进 121 秒后 heartbeat → `work_lease_lost`；`complete` 时 `consumed_through_seq < inbox_after_seq` → `invalid_request` |
| FR-5 | 过期置 stopped，不转派 | `test_work_queue.py::test_expired_after_ttl_plus_grace` + `test_worker_routes.py::test_sweeper_stops_lost_work`：claimed 项 clock +170 秒（未到 120+60）不在 `expired()`；+181 秒在；调用 `stop_expired_work` → 项 `status == "stopped"`；若会话 running（先 ingest 一个 `session.status_running`），则追加 `session.error`（`error.type == "worker_lost"`）与 `session.status_idle(retries_exhausted)`；之后 `claim_next` 返回 None（不转派） |
| FR-6 | ingest 分配 seq、校验状态 | `test_worker_routes.py::test_ingest_assigns_seq_and_validates`：ack 后 ingest `[status_running, agent.message]` → 返回 2 条，seq 紧接已有 seq；会话 `status == "running"`；ingest `user.message` → 400 `invalid_event_batch`；ingest 第二个 `status_running` → 400 且该批零写入（`last_seq` 不变、状态仍 running）；错误 device → 409 `work_lease_lost`；`status_idle(requires_action)` 引用批内的 `agent.tool_use` id → 会话 requires_action，此时调用方 POST user.message → 409 `session_requires_action` |
| FR-7 | inbox 投递 | `test_worker_routes.py::test_inbox_streams_client_events_after_cursor`：消息 seq=1 → 打开 inbox（`after_seq` 缺省）→ 收到 seq 1 的 `user.message`；随后调用方再 POST 一条 interrupt → inbox 实时收到；服务端事件（例如 ingest 的 agent.message）不出现在 inbox；收到的客户端事件 `processed_at` 被置位（`GET events` 可见） |
| FR-8 | complete 后补建 | `test_worker_routes.py::test_complete_creates_followup_item_for_unconsumed_messages`：项 inbox_after_seq=0，ingest running + idle(end_turn)；调用方再发一条 user.message（seq=k）；Worker 以 `consumed_through_seq=k-1` complete → 原项 `completed`，新建一个 queued 项且 `inbox_after_seq == k-1` |
| FR-9 | fail | `test_worker_routes.py::test_fail_marks_session`：running 中 fail（error 含 `Bearer abc123` 字样）→ 项 `failed`；会话出现 `session.error`（`worker_failed`，message 中 `Bearer` 后的值被 `redact_text` 处理或至少截断到 500 字符）与 `session.status_idle(retries_exhausted)` |
| FR-10 | 客户端错误映射 | `test_worker_sdk.py::test_client_error_mapping`（用 `httpx.MockTransport`）：401 → `WorkerAuthError`；409 `work_lease_lost` → `WorkLeaseLostError`；500 → `MAWorkerError`；异常字符串不含 token |
| FR-11 | 远程 broker | `test_worker_sdk.py::test_remote_broker_request_and_deliver`：用记录型假 sink；`announce_tool_use` 立即 flush 一个 `agent.tool_use`；`request_action(id, "tool_confirmation")` 先 flush 一个 `session.status_idle(requires_action, [id])` 再等待；`deliver(UserToolConfirmation(tool_use_id=id, result="allow"))` → 返回 True 且等待者拿到该事件；`deliver` 未知 id → False；`void_all` → 等待者得到 None；kind 不匹配（对 tool_confirmation 等待者投递 custom_tool_result）→ False |
| FR-12 | **W1 桌面路径端到端** | `test_w1_gate_worker_e2e.py::test_w1_gate_desktop_worker`：live server（`make_config` 的 `demo` Agent，manifest 为 `examples/managed/agents.dev.yaml` 中的 manifest、model 改 `fake/scripted`，`default_environment_id` 改为 `worker`）；Worker 端 `WorkItemRunner(llm_factory=PerSessionScriptFactory(load_fake_llm_script(examples/managed/w1_fake_script.json)[0]), workdir_root=tmp_path/"worker")`；调用方创建会话、POST user.message；后台 `asyncio.create_task(worker.run_once(max_wait_seconds=10))`；调用方轮询会话：第一次 requires_action → 对应 `agent.tool_use` 为 `bash_exec`、`evaluated_policy == "always_ask"` → POST allow；第二次 requires_action → `agent.custom_tool_use` `lookup_order` → POST 结果 `shipped`；最终 `session.status_idle(end_turn)`；bash 的 `agent.tool_result` 文本含 `ma-w1-ok`（在 Worker 的 `tmp_path/"worker"` 工作目录真实执行）；`run_once` 任务返回 True；Work Item `status == "completed"`；全部事件 seq 从 1 连续无重复 |
| FR-13 | Worker 中断 | `test_w1_gate_worker_e2e.py::test_worker_interrupt_during_requires_action`：第一次 requires_action 时 POST `user.interrupt` → 会话最终 `end_turn`，`agent.tool_result` 文本以 `CANCELLED: interrupted` 开头，Work Item `completed` |
| FR-14 | 心跳丢失 | `test_worker_sdk.py::test_runner_stops_on_lease_lost`：假 client 的 heartbeat 抛 `WorkLeaseLostError`，脚本 LLM 卡在 always_ask 等待 → runner 在 3 秒内返回，且**没有**调用 `complete` |
| FR-15 | 协议开关默认 legacy | `tests/test_enterprise_worker_ma_protocol.py::test_default_protocol_is_legacy`：仅 `_enable(...)`（拷贝 `tests/test_enterprise_worker.py:31-42` 的两个辅助函数到本文件）→ `worker_protocol() == "legacy"`；`run_once` 仍请求 `/api/desktop/worker/heartbeat` 与 `/tasks/claim`（用该文件里同款 `httpx.MockTransport` 断言请求路径），`MAWorker.run_once` 未被调用（`monkeypatch` 替身计数 0） |
| FR-16 | ma 模式分流 | `tests/test_enterprise_worker_ma_protocol.py::test_ma_protocol_routes_to_ma_worker`：设 `enterprise.worker.protocol: ma`、`ma_environment_ids: ["worker"]`、`ma_base_url: "http://127.0.0.1:9"`；`monkeypatch.setattr(MAWorker, "run_once", fake)`（fake 记录 kwargs 返回 True）→ `await worker.run_once()` 返回 True；fake 收到 `max_wait_seconds == 0`；MockTransport 未收到任何 `/api/desktop/worker/*` 请求 |
| FR-17 | ma 模式缺环境 | `tests/test_enterprise_worker_ma_protocol.py::test_ma_protocol_without_environments`：`protocol: ma`、无 `ma_environment_ids` → `run_once()` 返回 False，`status()["last_error"] == MA_ENV_MISSING`，无任何 HTTP 请求 |
| FR-18 | ma 模式鉴权失败暂停 | `tests/test_enterprise_worker_ma_protocol.py::test_ma_protocol_auth_error_pauses`：fake `run_once` 抛 `WorkerAuthError(401, "unauthorized", "x")` → 返回 False，`status()["last_error"] == AUTH_ERROR`；紧接着第二次 `run_once()` 不调用 fake（处于暂停期） |
| FR-19 | 非法协议值 | `tests/test_enterprise_worker_ma_protocol.py::test_unknown_protocol_value_is_legacy`：`protocol: "grpc"` → `worker_protocol() == "legacy"` |
| FR-20 | CLI worker | `test_worker_sdk.py::test_cli_worker_requires_token`：`CliRunner().invoke(main.app, ["ma", "worker", "--once"], env={"AGX_MA_DEV_TOKEN": ""})` exit code 2；`["ma", "worker", "--help"]` exit 0 且含 `--environment` |
| NFR-1 | 既有 Worker 测试不回归 | `pytest tests/test_enterprise_worker.py tests/test_enterprise_worker_routes.py -q --no-cov` 全绿（未改任何断言） |
| NFR-2 | MA 全量测试 | `pytest tests/managed -q --no-cov` 全绿（含 MA-A01–A04 用例） |
| NFR-3 | `agx serve` 冷启动 smoke（`server.py` 顶层 import 了 `enterprise_worker`） | 见 §7 smoke 命令：进程不崩溃，`/api/session`、`/api/avatars`、`/api/sessions` 返回 200 |
| NFR-4 | `server.py` 零改动 | `git diff --quiet -- agenticx/studio/server.py` |
| NFR-5 | 导入无环 | `python -c "import agenticx.studio.server"` 与 `python -c "import agenticx.runtime.enterprise_worker"` 均成功 |

## 7. 验证命令

```bash
cd /Users/damon/myWork/AgenticX
pytest tests/managed -q --no-cov
pytest tests/test_enterprise_worker.py tests/test_enterprise_worker_routes.py tests/test_enterprise_worker_ma_protocol.py -q --no-cov
pytest tests/test_studio_server.py -q --no-cov
python -c "import agenticx.studio.server; import agenticx.runtime.enterprise_worker; print('imports ok')"
git diff --quiet -- agenticx/studio/server.py && echo "server.py untouched"
```

**`agx serve` 冷启动 smoke（AGENTS.md 对 server.py 依赖链的强制门槛）：**

```bash
PORT=18765; TOKEN=smoke-$(date +%s)
agx serve --host 127.0.0.1 --port $PORT --token $TOKEN > /tmp/agx-serve-smoke.log 2>&1 &
PID=$!; sleep 12
for p in /api/session /api/avatars /api/sessions; do
  curl --noproxy '*' -s -o /dev/null -w "$p %{http_code}\n" -H "x-agx-desktop-token: $TOKEN" "http://127.0.0.1:$PORT$p"
done
kill $PID
```

期望三行均为 200（若 `/api/session` 需要 query 参数，按 `server.py` 现有约定补齐后仍须 200；不得为 5xx 或连接失败）。

**W1 桌面路径手动演示（三个终端）：**

```bash
# 1) host: agents.dev.yaml with default_environment_id switched to "worker" (copy the file and edit that one line)
agx ma serve --dev --port 8092 --agents-file /tmp/agents.worker.yaml --data-dir /tmp/agx-ma-w1w --token dev-token
# 2) worker
agx ma worker --base-url http://127.0.0.1:8092 --token dev-token -e worker \
  --fake-llm examples/managed/w1_fake_script.json --data-dir /tmp/agx-ma-worker
# 3) caller
python scripts/managed/w1_gate_demo.py --base-url http://127.0.0.1:8092 --token dev-token
# expect "W1 GATE PASSED"; the bash step runs under /tmp/agx-ma-worker/sessions/<sid>/work
```

**Near 桌面接入（可选，本机验证开关）**：在 `~/.agenticx/config.yaml` 设 `enterprise.enabled: true`、`enterprise.token: dev-token`、`enterprise.base_url: http://127.0.0.1:8092`、`enterprise.worker.enabled: true`、`enterprise.worker.protocol: ma`、`enterprise.worker.ma_environment_ids: [worker]`，重启 Near 后由 `agx serve` 内的 `EnterpriseWorker` 领取任务。验收后把 `protocol` 改回 `legacy` 或删除。

## 8. 回滚

- 开关：`enterprise.worker.protocol` 缺省 / `legacy` 时，`enterprise_worker.py` 行为与改动前一致（`run_once` 新增分支不进入，新增 import 只是加载模块）。
- 代码回滚：删除第 3 节新建文件；`git checkout agenticx/managed/host/app.py agenticx/cli/ma_commands.py agenticx/runtime/enterprise_worker.py tests/managed/test_host_api.py`。

## 9. 不变量

- `legacy` 协议：心跳、领取、Studio `/api/chat` 执行、确认拒绝、完成 / 失败上报的请求路径与载荷不变；`tests/test_enterprise_worker.py` 不改一行仍全绿。
- `EnterpriseWorker.status()` 返回结构不变。
- Worker 永不回传客户端事件类型；宿主分配全部 seq；`session.status_running` 在 resolution 到齐时只由宿主写一次。
- Work Item 进入 `failed` / `stopped` 后永不被再次领取。
- `agenticx/studio/server.py` 零改动。

## 10. 风险

1. `enterprise_worker.py` 新增顶层 import 让 `agx serve` 启动时加载 `agenticx.managed.*`。这些模块只依赖已被 Studio 加载的 runtime / cli 模块，但任何 import 错误都会让 `agx serve` 起不来——NFR-3 smoke 是硬门槛。
2. W1 宿主上任意 `ma:worker` token 可领取任意 `desktop_worker` 环境（无 `worker_keys` 校验），仅限本机开发。
3. 宿主重启会把租约中的 Work Item 置 `stopped`、会话置 `retries_exhausted`；Worker 随后的 ingest / heartbeat 得到 409 并停止。
4. Worker 用本机 provider 配置：manifest 的 `<provider>/<model>` 在员工本机不存在时，回合以 `retries_exhausted` 结束并带 `session.error(internal_error)`；改走企业网关在 MA-D01 / MA-E03。
