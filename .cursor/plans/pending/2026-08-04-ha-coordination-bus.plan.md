# Plan C：进程间协调总线（会话锁 / cancel 广播 / SSE replay）

Planned-with: kimi-k3
Suggested-Impl-Model: kimi-k3-max（分布式锁续期与 replay 语义易踩坑）
Status: pending-review
Parent-Plan: `.cursor/plans/pending/2026-08-04-agenticx-ha-roadmap.plan.md`
Depends-On: `.cursor/plans/pending/2026-08-04-ha-session-storage-abstraction.plan.md`（复用其 Redis 连接与工厂解析）
Covers-Gap: G-003，证据见 `research/codedeepresearch/agentscope/agentscope_ha_gap_analysis.md`

## 根因与证据链

多副本的直接障碍有三：(1) 会话互斥靠进程内 `asyncio.Lock`（`agenticx/studio/session_manager.py:511` `_continuation_locks`），跨副本无效——同一会话可在两个副本并发跑，写互相踩踏；(2) interrupt 是进程内集合 `_interrupt_requests`（`session_manager.py:510,706,723`），副本 B 无法打断副本 A 上的会话；(3) SSE 无 replay——已知问题「切换会话后尾部 SSE（含 final）未必送达」，断线即丢事件。

对标机制（AgentScope `RedisMessageBus`）：会话锁 = `SET NX` + TTL + heartbeat 续期（`message_bus/_redis_message_bus.py:554-611`）；cancel/interrupt 广播各进程自择处理；session events = replay log（`log_append`/`log_read`，上限 1000，`message_bus/_keys.py:112-115`）+ live pub/sub，SSE 先重放再订阅（`app/_router/_session.py:710-764`）。

## In scope

新增：
- `agenticx/runtime/coordination/__init__.py`
- `agenticx/runtime/coordination/bus.py`
- `agenticx/runtime/coordination/in_process.py`
- `agenticx/runtime/coordination/redis_bus.py`
- `agenticx/runtime/coordination/factory.py`
- `tests/test_ha_coordination_bus.py`

修改（只允许这些文件）：
- `agenticx/studio/session_manager.py`
- `agenticx/studio/server.py`（**红线文件**：只精确增删目标行；提交前 `agx serve` 冷启动 smoke，`/api/session`、`/api/avatars`、`/api/sessions` 返回 200）
- `agenticx/cli/config_manager.py`（仅新增配置键）

## Out of scope

- 不引入 NATS/Kafka/Redis Streams 之外的 broker；不为 wakeup 队列做持久化 job 语义（resume 队列由 Plan B 的 checkpoint + 启动扫描覆盖）。
- 不做事件溯源（event sourcing）；replay log 是有界缓冲，不是历史存储。
- 不改 `/api/chat` 的 SSE 事件类型与 payload 格式（前端零改动）。
- 不动 `GlobalMcpManager` 与 MCP 连接（G-005 已部分并入 Plan A，其余暂缓）。
- 不做标准 SSE `Last-Event-ID` 协议兼容（对标对象也未做，E-009；用自有 cursor 查询参数即可）。

## FR 与 AC

### FR-1：`CoordinationBus` Protocol

落点：新建 `agenticx/runtime/coordination/bus.py`。

```python
class SessionLock(Protocol):
    owner: str
    async def renew(self) -> bool: ...      # heartbeat 续期；失败返回 False
    async def release(self) -> None: ...
    async def __aenter__(self) -> "SessionLock": ...
    async def __aexit__(self, *exc) -> None: ...

class CoordinationBus(Protocol):
    async def acquire_session_lock(self, session_id: str, *, owner: str, ttl_ms: int = 30000) -> SessionLock | None: ...
    async def publish_cancel(self, session_id: str) -> None: ...
    async def subscribe_cancel(self, callback: Callable[[str], Awaitable[None]]) -> None: ...  # 进程内注册，收到本进程不持有的会话时忽略
    async def event_append(self, session_id: str, event: dict) -> str: ...   # 返回 cursor（单调递增字符串）
    async def event_read(self, session_id: str, *, since: str | None = None, limit: int = 1000) -> list[tuple[str, dict]]: ...
    async def event_trim(self, session_id: str, *, max_len: int = 1000) -> None: ...
    async def ping(self) -> bool: ...
```

设计意图：对齐 AgentScope 语义——锁带租约（持锁进程崩溃 → TTL 过期 → 他副本可接管，对应 Plan B 的 resume）；replay log 上限 1000（`SESSION_REPLAY_MAX_LEN` 同款语义）；cancel 是广播，各进程自行判断自己是否持有目标会话。

**AC-1**：`tests/test_ha_coordination_bus.py::test_bus_contract` 对 InProcess/Redis（fakeredis）两实现跑同一用例集：锁互斥（第二 acquire 返回 None）、release 后可再获取、cancel 订阅收到消息、event append/read/since 过滤/trim 上限。

### FR-2：`InProcessBus`（默认，现状语义等价）

落点：新建 `agenticx/runtime/coordination/in_process.py`。

- 锁 = 进程内 `dict[str, asyncio.Lock]` + owner 记录；`renew` 恒 True；无 TTL（进程即边界）。
- cancel = 进程内 callback 直调。
- event log = `collections.deque(maxlen=1000)` per session。
- **行为不变量**：单机默认模式下，现有 interrupt/锁行为与 main 分支完全一致。

**AC-2**：现有测试 `pytest tests/ -k "interrupt or continuation or chat"` 全绿。

### FR-3：`RedisBus`

落点：新建 `agenticx/runtime/coordination/redis_bus.py`。

- 连接复用 `agenticx/server/redis_backend.py` 的 `RedisBackend`（同 Plan A 约定）。
- key/通道（prefix `agenticx:` 之后）：
  - 锁：`lock:sess:{sid}` → `SET {owner} NX PX {ttl}`；`renew` 用 Lua `if get==owner then pexpire`；`release` 用 Lua `if get==owner then del`；后台 task 每 `ttl/3` 自动 renew（task 随 release 取消）。
  - cancel：`pubsub` channel `cancel`；消息体 JSON `{"session_id": ...}`。
  - replay log：`ev:sess:{sid}` → capped list（`RPUSH` + `LTRIM -1000 -1`）；cursor = `"{llen_before+1}"` 单调序号（实施者可用 `INCR ev:sess:{sid}:seq` 作为 cursor 源，list 存 `seq` 字段；二选一，须在代码注释写明选择及理由）。
- Redis 不可用时的降级：**启动期** `ping` 失败 → 工厂回退 InProcess 并 `logger.warning`（对齐 `RedisBackend` 既有优雅降级语义）；**运行期**断连 → lock renew 失败时当前会话视为失去锁，主动触发本地 interrupt（防双写），log error。

**AC-3**：`test_redis_lock_lease_takeover`：fakeredis 上 owner A 持锁后不 renew（模拟崩溃），TTL 过期后 owner B acquire 成功。
**AC-4**：`test_redis_disconnect_degrade`：mock ping 失败 → 工厂回退 InProcess 且有 warning 日志。

### FR-4：SessionManager 接线

落点：`agenticx/studio/session_manager.py`。

- `__init__`（504-515 区域）：新增 `self._bus = get_coordination_bus()` 与 `self._instance_id = uuid4().hex[:8]`（作为 lock owner）。
- `_continuation_locks`（511/714）：保留属性名作为 InProcess 兼容层，内部改为委托 `self._bus.acquire_session_lock(sid, owner=self._instance_id)`；**acquire 返回 None（他副本持有）时的行为**：新 chat 请求返回 409 风格 SSE 错误事件 `{"type": "error", "error": "session_busy_elsewhere"}`（新事件类型，仅 HA 模式可触发，单机不会走到）。
- interrupt 路径（706/719/723）：`request_interrupt` 除现有进程内集合外，同时 `await self._bus.publish_cancel(sid)`；启动时 `subscribe_cancel` 注册回调：若 `sid in self._sessions`（本进程持有）→ 走现有 interrupt 逻辑，否则忽略。

**AC-5**：`test_cross_process_interrupt`：两个 `SessionManager` 实例共享 fakeredis bus；sid 在实例 A 注册，实例 B 调 `request_interrupt` → A 的 `is_interrupt_requested(sid)` 变 True。
**AC-6**：`test_session_lock_conflict`：A 持锁时 B 的新 chat 路径收到 `session_busy_elsewhere`。

### FR-5：SSE replay-then-live

落点：`agenticx/studio/server.py` 的 `/api/chat`（2482-2483）事件发布与流式生成路径。

- 发布侧：chat 流式路径中每个 SSE 事件在 yield 前 `await bus.event_append(session_id, event_dict)`；turn 结束（FINAL 后）`await bus.event_trim(session_id)`。事件量大的 token 流允许聚合：仅 `token` 类型事件可按「每 50 个或 250ms」合并为一条 append（合并语义写进代码注释；其它事件类型逐条 append）。
- 重连侧：`/api/chat` 支持可选查询参数 `?resume_cursor={cursor}`：先 `event_read(sid, since=cursor)` 补齐缺失事件，再接入 live 流。无 cursor 时行为与现状一致。
- 同步暴露 `GET /api/session/{id}/events?since=` 只读补拉端点（供前端断线重连对齐，路径若与现有路由冲突则实施者选择最不冲突的命名并在 plan 回执说明）。

**AC-7**：`test_sse_replay`：模拟 turn 中产生 5 个事件后断开；带 cursor 重连，断言补齐事件 3-5 且顺序与 cursor 单调；不带 cursor 重连行为与 main 一致。

### FR-6：工厂与配置

落点：`agenticx/runtime/coordination/factory.py` + `agenticx/cli/config_manager.py`。

- 解析：env `AGX_COORDINATION_BACKEND` > `runtime.coordination_backend` > 默认：若 `AGX_STORAGE_BACKEND=redis`（或 `AGX_HA_MODE=redis`）则 `redis`，否则 `inprocess`。
- 进程级懒加载单例 + `reset_coordination_bus_for_testing()`。

**AC-8**：`test_bus_factory_resolution`：四种 env 组合解析正确；redis 不可用时回退 inprocess（FR-3 语义）。

## 发现的非目标问题（记录，不修）

- token 级事件全量 append 在 redis 模式下有吞吐上限，FR-5 的聚合是止血；长期方案（分片/采样）待实测数据另立项。
- `session_busy_elsewhere` 需要前端后续识别并提示（Desktop 改动不在本 plan；先保证后端语义正确）。

## 验证

```bash
pytest tests/test_ha_coordination_bus.py -v
pytest tests/ -k "interrupt or continuation or chat or sse" -q
agx serve --host 127.0.0.1 --port 17501 &  # 冷启动 smoke（server.py 红线）
# 双进程手工验证：两实例同连一个 redis，A 起会话，B 发同会话消息应收到 session_busy_elsewhere；B 调 interrupt 应打断 A
```
