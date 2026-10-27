# MA-A09 会话后台工具任务（bash 自动转后台、task_* 工具、session.task_* 事件、任务 API）

Planned-with: Claude Opus 5.5
Suggested-Impl-Model: Grok 4.7
Parent: .cursor/plans/2026-10-25-managed-agents-master.plan.md（W6，编号 MA-A09）
Depends-on: MA-A04（已实施）、MA-E03（已实施）；MA-A06 / MA-A07（pending，见 §4.9 的合并规则，以实际实现为准，实施前核对）
Blocks: MA-A08（复用本子规划新增的 `TurnContinuation`、`PlatformToolResolver` 与权限引擎 `platform` 来源）

> 风险等级：中。改动托管宿主的回合循环（`LocalTurnExecutor._run`），并在个人模式共用的 `agenticx/cli/agent_tools.py` 增加**一处**由会话属性短路的分支。全部能力由开关 `tasks_enabled`（默认关）控制，关闭时行为与改动前逐字一致。

---

## 0. 一句话目标

云端托管会话里，`bash_exec` 运行超过 60 秒仍未结束时自动转为**会话后台任务**并立即把 `task_id` 交还模型；主 Agent 自动获得 `task_list` / `task_get` / `task_kill` 三个工具；任务创建与结束各落一条 `session.task_created` / `session.task_completed` 事件；任务结束时自动唤醒主线程继续处理；只要还有未结束任务，会话保持 `running`；对外提供 `GET /ma/v1/sessions/{id}/tasks`、`GET .../tasks/{task_id}`、`POST .../tasks/{task_id}/cancel`。

---

## 1. 根因 / 动机与证据链

### 1.1 来自 master 的约束

| master 位置 | 内容 | 本文落点 |
|---|---|---|
| §3.3 缺口表「后台工具任务」行 | 四家中火山有；框架有 `durable_jobs`；企业无 | 本文 |
| §6.1 | `session.task_*` 由 MA-A09 启用 | §6.1 定义两种事件 |
| §6.2 | 状态机：`running → idle` 由回合结束触发 | 回合结束时若仍有未结束任务，**不**发 `status_idle`，继续等待（§2 D4） |
| §9 MA-A09 行 | 「`durable_jobs` 暴露为会话任务；`task_list` / `task_get` / `task_kill` 工具与 `session.task_*` 事件；超过 60 秒的 bash 自动转后台」 | 工具与事件照做；**不复用 `durable_jobs`**（§2 D1，需登记 master §12） |
| §12「托管内置工具白名单 14 个」 | Manifest 未列出的工具一律 deny | task_* 不是内置工具，走新的「平台工具」来源（§2 D3），不改白名单 |
| §12「已知限制 max_tool_rounds 软上限」 | runtime 会放宽轮次 | 本文不改 runtime |

### 1.2 调研语义（`research/managed-agents/volcengine/background-tool-tasks.md`）

- L13–14：明确要求后台执行时立即返回 `task_id`；正常执行默认等待 60 秒，未完成的同一个任务转后台并返回 `task_id`。
- L16：任务是 Session 子资源，无单独创建接口；主 Agent 自动获得 `task_list` / `task_get` / `task_kill`。
- L52：只要仍有未结束任务或待处理的完成通知，Session `status` 保持 `running`；完成通知会唤醒主线程。
- L60–63：状态 `succeeded` / `failed` / `cancelled` / `unknown`。
- L163：`user.interrupt` 会尝试取消运行中的任务（非原子）。
- L167：显式中断后的迟到通知不会自动恢复执行。
- L181–184：每 Session 并发上限；自托管 Environment、子 Agent 暂不支持后台任务。

### 1.3 现状代码证据（2026-10-25 核对，实施前重新核对行号）

| 文件 | 行 | 现状 | 结论 |
|---|---|---|---|
| `agenticx/runtime/durable_jobs/store.py` | 28–46、57–70 | SQLite 文件 `~/.agenticx/durable_jobs.sqlite`，列 `owner/kind/status/lease_id/lease_until/payload_json`，`threading.Lock` + 每次新连接 | 面向本机、可恢复的长作业；agent-runtime 是 PG 多副本服务 |
| `agenticx/runtime/durable_jobs/worker.py` | 22–112 | `DurableJobWorker` 用**线程**跑 handler，租约心跳靠 CAS | 子进程在宿主重启后无法续跑，租约语义对 bash 子进程没有收益 |
| `agenticx/cli/agent_tools.py` | 6475–6569 | `_tool_bash_exec`：`timeout_sec` 缺省取 `_bash_exec_default_timeout_sec()`（L5817–5829，默认 30，上限 3600），`asyncio.wait_for` 超时即 `proc.kill()` 并返回 `ERROR: command timeout after {n}s`；输出格式 `exit_code=…\nstdout:\n…\nstderr:\n…`（L6565–6569） | 托管模式需要「60 秒后转后台」而非杀进程 |
| `agenticx/cli/agent_tools.py` | 6124–6132 | `_bash_exec_prepare(command, arguments, session, *, tool_name, confirm_gate, emit_event) -> _BashPrepared | str`：统一做长度校验、权限、命令沙箱（`_apply_command_sandbox`，L6050–6121）与 argv 构造 | 托管后台执行复用它，沙箱与确认语义不变 |
| `agenticx/cli/agent_tools.py` | 5910–5933、6304–6391 | 已有个人模式 `bash_bg_start` / `bash_bg_poll` / `_BASH_BG_JOBS` 进程级字典、`_BASH_BG_MAX_JOBS_DEFAULT = 8` | 个人模式专用，不在托管白名单；本文**不修改**这些函数，仅借鉴上限 8 |
| `agenticx/cli/agent_tools.py` | 12926–12950 | `_dispatch_tool_async_unredacted` 在 `try:`（L12927）之后先判 `META_TOOL_NAMES`，再 `if name == "bash_exec": return await _tool_bash_exec(...)` | 内置 `bash_exec` 不经 fallback chain，托管替换只能在此加一处覆盖分支 |
| `agenticx/cli/agent_tools.py` | 13297–13309 | 未知工具名最后进 `session._fallback_chain.execute(name, **arguments)`，否则 `ERROR: unknown tool` | task_* 作为非内置名可经 fallback chain 解析 |
| `agenticx/tools/fallback_chain.py` | 62–64 | `register(level, resolver)` 每个 level 只保存**一个** resolver | 自定义工具已占用 `API_CONNECTOR`（`builder.py` L127–130），需要一个组合 resolver |
| `agenticx/managed/permissions.py` | 76–126 | `evaluate`：custom → allow；企业 deny；`spec.tool(name) is None` → deny（`unlisted`） | task_* 会被判 `unlisted` 拒绝 → 新增 `platform` 来源 |
| `agenticx/managed/host/actor.py` | 286–445 | `LocalTurnExecutor`：`submit_message` 回合进行中则入 `_queue`；`_run` 单回合，结束即 `finish_turn_locked`（发 `status_idle`）再取队列 | 需要「回合结束但仍有任务 → 继续等待并唤醒」的循环 |
| `agenticx/managed/host/service.py` | 79–98 | `startup()` 对 `list_unsettled_sessions()` 调 `recover_after_restart()` | 重启时补齐未结束任务的终态事件 |
| `agenticx/managed/events/adapter.py` | 43–92 | `ToolUseLedger`：`bind` 把宣告的 tool use 绑到 runtime `tool_call_id`；只有 `inflight_custom(name)` | 需要按名字取最近绑定的 builtin 事件 id，作为任务的 `tool_use_id` |
| `agenticx/managed/protocol.py` | 53–68、305–321 | `SERVER_EVENT_TYPES` 14 项；`ServerEvent` 判别联合 | 新增两种事件 |
| `tests/managed/test_protocol.py` | 110 | `assert [sample["type"] for sample in samples] == list(SERVER_EVENT_TYPES)` | 必须同步补样例 |
| `enterprise/apps/admin-console/src/lib/ma-session-console.ts` | 148–214 | 回放时未知类型落到 `default → kind:"other"` | 观测台不因新事件报错，本文不改 |

---

## 2. 关键设计决策

| # | 决策 | 理由 |
|---|---|---|
| D1 | **不复用 `durable_jobs`，也不新建表**。任务的持久状态 = 两条会话事件；运行态（子进程句柄、输出尾部）只在持有会话 actor 的进程内存中 | durable_jobs 是 SQLite + 线程 + 租约，为「本机可恢复作业」设计；bash 子进程在宿主重启后无法续跑，租约无收益；事件已经持久、租户隔离、可流式订阅、可回放。登记 master §12 |
| D2 | **自动转后台**：托管会话内 `bash_exec` 由 `ManagedBashRunner` 执行：先等待 `task_foreground_seconds`（默认 60）；期间结束 → 返回与原 `_tool_bash_exec` 相同格式的结果，不产生任务；未结束 → 同一进程转为任务，立即返回 `task_id` 文本 | 与调研 L14 一致；不改个人模式 `_tool_bash_exec` |
| D3 | **平台工具**：`task_list` / `task_get` / `task_kill` 由宿主注入（不在 Manifest、不进内置白名单），权限引擎新增来源 `platform`：企业 deny 仍优先，其余一律 allow；工具 schema 追加到本回合工具表，解析经新组合 resolver `PlatformToolResolver` | 调研 L16「主 Agent 自动获得」；不改 master 冻结的白名单 |
| D4 | **会话保持 running**：新增 `TurnContinuation`；回合以 `end_turn` 结束且仍有未结束任务时，先落本回合的终态事件（span / usage），**不发** `status_idle`，等待唤醒：任务完成通知或排队的用户消息；唤醒后以通知文本开下一回合（同一 running 区间，不再发 `status_running`）；直到无待处理项才 `turn_finished` | 调研 L52、L167；状态机不改 |
| D5 | **中断**：`user.interrupt`（无 `thread_id`）→ 停当前回合、取消全部运行中任务（终态 `cancelled`，`error.type="interrupted"`），不再唤醒；之后到达的完成事件只落库不唤醒 | 调研 L163、L167 |
| D6 | 回合以 `end_turn` 之外的原因结束（`max_tool_rounds` / `retries_exhausted` / `policy_blocked` 等）时，取消全部运行中任务（`error.type="session_stopped"`）后再发 `status_idle` | 避免「会话 idle 但还有进程在跑」，与 D4 的不变量一致 |
| D7 | **范围**：只在 `cloud` 环境的主线程生效。`desktop_worker` 环境、MA-A08 的成员线程不注入任务能力（调研 L182–184 同样限制） | Worker 执行器在员工本机，进程模型不同；成员线程见 MA-A08 |
| D8 | 每会话同时运行任务上限 `max_running_tasks`（默认 8）；超过时 `bash_exec` 在**转后台时刻**直接杀进程并返回 `ERROR: too many background tasks (max 8); stop one with task_kill first` | 与个人模式 `bash_bg` 上限一致 |
| D9 | 总时长上限：模型显式给 `timeout_sec` 时按它（`<= task_foreground_seconds` 时行为与原工具完全一致：到点杀进程并返回 `ERROR: command timeout after {n}s`）；未给时为 `task_max_runtime_seconds`（默认 3600）。后台任务到总时长 → 杀进程，终态 `failed`，`error.type="timeout"` | 原工具缺省 30 秒会让命令永远到不了 60 秒，托管模式必须改缺省 |
| D10 | 托管 `bash_exec` schema 增加可选参数 `run_in_background: boolean`（只改本会话工具表里的副本），为 true 时启动后立即转任务 | 调研 L13「明确要求后台执行」 |
| D11 | 任务输出写入会话工作目录 `.ma/tasks/<task_id>.log`（仅转后台后写），内存只保留尾部 64 KiB；事件里 `result.output` 只存尾部 8000 字符 | 工作目录本就对 Agent 可见；事件不膨胀 |
| D12 | 宿主重启：`startup()` 对未结束会话中「有 created 无 completed」的任务补一条 `session.task_completed(state="failed", error.type="host_restarted")`，再执行现有恢复 | 进程已不存在，必须给出终态 |
| D13 | 多副本：任务运行态只在持有 actor 的进程里。查询 / 取消打到其它副本时，运行中任务显示 `state="unknown"`、取消返回当前记录不报错。会话粘性路由不在本文范围 | 与 E03 现有「actor 在进程内」假设一致；如实写入文档 |

---

## 3. In scope / Out of scope

### 3.1 In scope（只能创建或修改这些文件）

框架（Python）：
- 新建 `agenticx/managed/host/continuation.py`
- 新建 `agenticx/managed/host/platform_tools.py`
- 新建 `agenticx/managed/host/tasks.py`
- 修改 `agenticx/managed/protocol.py`（两种事件类型与模型、联合类型）
- 修改 `agenticx/managed/errors.py`（新增 `TASK_NOT_FOUND`，§4.9）
- 修改 `agenticx/managed/permissions.py`（`PermissionEngine` 增 `platform_tools`、`DecisionSource` 增 `"platform"`）
- 修改 `agenticx/managed/events/adapter.py`（`ToolUseLedger.latest_bound_event_id`）
- 修改 `agenticx/managed/host/config.py`（`HostConfig` 四个字段）
- 修改 `agenticx/managed/host/actor.py`（`LocalTurnExecutor` 回合循环、安装平台工具与 bash 覆盖）
- 修改 `agenticx/managed/host/service.py`（`startup` 补终态、`list_tasks` / `get_task` / `cancel_task`）
- 修改 `agenticx/managed/host/routes.py`（三个路由）
- 修改 `agenticx/managed/spec.py`（`PLATFORM_TOOL_NAMES` 常量与自定义工具重名语义校验）
- 修改 `agenticx/cli/ma_commands.py`（`serve` 增 `--enable-tasks`）
- 修改 `agenticx/cli/agent_tools.py`（**仅** `_dispatch_tool_async_unredacted` 内一处 4 行插入，§4.8）

企业（Python，agent-runtime）：
- 修改 `enterprise/apps/agent-runtime/ma_agent_runtime/config.py`（4 个环境变量 → `Settings` 字段）
- 修改 `enterprise/apps/agent-runtime/ma_agent_runtime/app.py`（把 Settings 字段传入 `HostConfig`）

TS 类型（同语义镜像，MA-00 的双端一致规则）：
- 修改 `enterprise/packages/core-api/src/managed-agents.ts`（`SERVER_EVENT_TYPES` 追加 2 项、两个 interface、`ServerEvent` 联合）

测试与文档：
- 新建 `tests/managed/test_continuation.py`、`tests/managed/test_session_tasks.py`、`tests/managed/test_task_routes.py`、`tests/test_agent_tools_managed_override.py`
- 修改 `tests/managed/test_protocol.py`（L110 处样例列表补两项）、`tests/managed/test_permissions.py`（追加 platform 用例）、`tests/managed/test_spec.py`（追加重名用例）
- 修改 `enterprise/apps/agent-runtime/tests/test_config.py`（追加环境变量用例）
- 修改 `enterprise/packages/core-api/src/__tests__/managed-agents.test.ts`（追加常量断言）
- 修改 `docs/managed-agents/protocol.md`（追加「后台工具任务（MA-A09）」一节）

### 3.2 Out of scope

- 不改 `agenticx/runtime/durable_jobs/*`、`agenticx/runtime/agent_runtime.py`、`agenticx/managed/events/state_machine.py`。
- 不改个人模式 `_tool_bash_exec`、`bash_bg_*` 的任何逻辑。
- `desktop_worker` 环境（Worker SDK `agenticx/managed/worker/*`）不支持后台任务。
- MA-A08 成员线程不支持后台任务。
- 不做 `video_generate` 等其它后台工具；不做任务输出的独立下载接口（日志在会话工作目录内）。
- 不改 Desktop（`desktop/`）、门户、管理台的渲染（未知事件类型已有兜底）；Near 渲染另起子规划。
- 不做多副本会话粘性路由。
- 不新增 PAT scope（复用 `ma:sessions:read` / `ma:sessions:write`）。

---

## 4. 精确落点

所有新 Python 文件头：

```python
#!/usr/bin/env python3
"""<一句英文说明>.

Author: Damon Li
"""

from __future__ import annotations
```

英文注释、绝对 import、import 置顶（`agenticx/cli/agent_tools.py` 中私有函数的导入写在模块顶部，不在函数体内）。

### 4.1 新建 `agenticx/managed/host/continuation.py`

```python
from dataclasses import dataclass
from typing import Literal
import asyncio

from agenticx.managed.events.store import StoredEvent

WakeSource = Literal["task", "thread"]


@dataclass(frozen=True)
class WakeUp:
    """A persisted notification that must start the next primary turn."""

    source: WakeSource
    event: StoredEvent


class TurnContinuation:
    """Pending background units and queued wake-ups of one session.

    Only the primary-turn loop awaits ``wait()``. Producers call
    ``register_pending`` before starting a unit and ``resolve_pending`` exactly
    once when it ends. ``poke()`` wakes the waiter without a wake-up so it can
    re-check the user message queue or the stop flag.
    """

    def __init__(self) -> None:
        self._pending: set[str] = set()
        self._queue: list[WakeUp] = []
        self._signal = asyncio.Event()
        self._closed = False

    def register_pending(self, key: str) -> None: ...
    def resolve_pending(self, key: str, wake: WakeUp | None) -> None:
        """Drop ``key``; enqueue ``wake`` when given and not closed; set the signal."""
    def poke(self) -> None: ...
    @property
    def has_pending(self) -> bool:  # bool(self._pending) or bool(self._queue)
        ...
    def pending_keys(self) -> frozenset[str]: ...
    async def wait(self) -> WakeUp | None:
        """Return the oldest queued wake-up.

        Returns None when poked, when closed, or when nothing is pending and the
        queue is empty. Never blocks when ``has_pending`` is False.
        """
    def close(self) -> None:
        """Drop queued wake-ups, mark closed, set the signal. Pending keys are kept for accounting."""
    def reopen(self) -> None:
        """Clear the closed flag at the start of a new user turn."""
```

实现要点（逐条）：
- `wait()`：循环 `while True: if self._queue: return self._queue.pop(0); if self._closed or not self._pending: return None; self._signal.clear(); await self._signal.wait(); if <被 poke 标记>: 清标记并 return None`。用一个私有 `self._poked: bool` 区分 poke；`poke()` 置 `_poked=True` 再 `set()`。
- `resolve_pending(key, wake)`：`self._pending.discard(key)`；`wake is not None and not self._closed` 时追加；最后 `self._signal.set()`。重复 resolve 同一 key 无副作用。
- `close()` 后 `resolve_pending` 带的 wake 被丢弃（D5「迟到通知不唤醒」）。

另导出函数：

```python
def wake_text(event: StoredEvent) -> str:
    """Model-facing text for a wake-up event. MA-A08 adds agent.thread_message_received."""
```

`session.task_completed` 的文本（逐字模板，`<...>` 取事件字段，`output` 取 `result.output` 尾部 4000 字符，缺省为 `(empty)`）：

```
[background task notification]
task_id=<task_id> state=<state> exit_code=<exit_code 或 null>
command: <summary>
output (tail):
<output>
```

其它类型 → `ValueError(f"no wake text for {event.type}")`。

### 4.2 新建 `agenticx/managed/host/platform_tools.py`

```python
from typing import Any, Awaitable, Callable, Mapping

from agenticx.tools.fallback_chain import ToolResolver

PlatformHandler = Callable[[dict[str, Any], "str | None"], Awaitable[str]]
"""handler(arguments, tool_call_id) -> result text. Must not raise."""


class PlatformToolResolver(ToolResolver):
    """Host-injected tools first, then the wrapped custom-tool resolver.

    ``resolve`` strips keys starting with ``__`` from kwargs before calling a
    platform handler and passes ``kwargs.get("__tool_call_id")`` separately.
    """

    def __init__(self, delegate: ToolResolver | None) -> None: ...
    def register(self, name: str, schema: dict[str, Any], handler: PlatformHandler) -> None:
        """Duplicate name -> ValueError(f"platform tool already registered: {name}")."""
    def names(self) -> frozenset[str]: ...
    def schemas(self) -> list[dict[str, Any]]:  # deep copies, registration order
        ...
    async def can_handle(self, task_intent: str) -> bool:
        # name in handlers, else delegate.can_handle when delegate is not None, else False
        ...
    async def resolve(self, task_intent: str, **kwargs: Any) -> str:
        # platform: try handler; on Exception -> logger.exception + return f"ERROR: tool {task_intent} failed"
        # else delegate.resolve(task_intent, **kwargs); no delegate -> f"ERROR: unknown tool '{task_intent}'"
        ...
```

### 4.3 新建 `agenticx/managed/host/tasks.py`

常量与数据：

```python
TASK_TOOL_NAMES: tuple[str, ...] = ("task_list", "task_get", "task_kill")
TASK_EVENT_TYPES: tuple[str, ...] = ("session.task_created", "session.task_completed")
TASK_LOG_DIR = ".ma/tasks"
OUTPUT_TAIL_BYTES = 65536          # in-memory tail per task
EVENT_OUTPUT_CHARS = 8000          # result.output in session.task_completed
SUMMARY_CHARS = 200                # summary = command[:200]
KILL_GRACE_SECONDS = 5.0

TaskState = Literal["running", "succeeded", "failed", "cancelled", "unknown"]


@dataclass
class TaskRecord:
    task_id: str
    session_id: str
    tool_name: str
    tool_use_id: str | None
    summary: str
    state: TaskState
    created_at: str
    finished_at: str | None = None
    log_path: str | None = None          # relative to the session workdir, e.g. ".ma/tasks/<id>.log"
    exit_code: int | None = None
    output: str = ""                     # tail; live tail for running tasks
    error: dict[str, str] | None = None  # {"type","message"}
    duration_ms: int = 0

    def to_wire(self, *, include_output: bool) -> dict[str, Any]: ...


def fold_task_events(rows: Sequence[StoredEvent]) -> dict[str, TaskRecord]:
    """Build records from seq-ordered task events. created without completed -> state "unknown"."""
```

`TaskRecord.to_wire`（JSON 形状见 §6.3）。

`SessionTaskManager`（每个 `SessionActor` 至多一个，`LocalTurnExecutor` 创建）：

```python
class SessionTaskManager:
    def __init__(
        self,
        *,
        actor: "SessionActor",
        continuation: TurnContinuation,
        foreground_seconds: float,
        max_runtime_seconds: float,
        max_running: int,
    ) -> None: ...

    @property
    def running_count(self) -> int: ...
    def has_running(self) -> bool: ...
    def live_record(self, task_id: str) -> TaskRecord | None: ...
    def live_records(self) -> list[TaskRecord]: ...

    def install(self, bundle: "ManagedRuntimeBundle", resolver: PlatformToolResolver) -> None:
        """Register task_* handlers, patch the bash_exec schema copy in bundle.tools (D10),
        and set bundle.session.managed_tool_overrides = {"bash_exec": self.run_bash}."""

    async def run_bash(
        self,
        arguments: dict[str, Any],
        session: Any,
        *,
        confirm_gate: Any,
        emit_event: Any = None,
    ) -> str:
        """Managed replacement for bash_exec (D2/D8/D9/D10)."""

    async def kill(self, task_id: str, *, error_type: str, message: str, wake: bool) -> TaskRecord | None:
        """SIGTERM, wait KILL_GRACE_SECONDS, SIGKILL; append session.task_completed(cancelled).
        Returns the final record, or None when the task is unknown here. Idempotent for finished tasks."""

    async def cancel_all(self, *, error_type: str, message: str) -> None:
        """kill(..., wake=False) for every running task, concurrently."""

    async def close(self) -> None:
        """cancel_all(error_type="session_closed", message="session closed")."""
```

`run_bash` 流程（逐步，实施时照此写）：
1. `command = str(arguments.get("command", "")).strip()`；`background = arguments.get("run_in_background") is True`。
2. 计算 `explicit = arguments.get("timeout_sec")`：可转 int 且非空串 → `hard = max(1, min(86400, int(explicit)))`；否则 `hard = max_runtime_seconds`。
3. `prepared = await _bash_exec_prepare(command, arguments, session, tool_name="bash_exec", confirm_gate=confirm_gate, emit_event=emit_event)`；返回 str 直接返回（与原工具一致）。
4. `asyncio.create_subprocess_exec(*prepared.argv, stdout=PIPE, stderr=PIPE, cwd=..., env=prepared.env)`；失败返回 `f"ERROR: command failed to start: {exc}"`（与原文案一致）。
5. 启动两个读管道协程，把行写入 `_Proc.lines`（带 `stdout`/`stderr` 标签，保留尾部 `OUTPUT_TAIL_BYTES`）；`_Proc.log_file` 为 None 时只写内存。
6. `wait_s = 0 if background else min(foreground_seconds, hard)`。`await asyncio.wait({proc_wait_task}, timeout=wait_s)`。
   - 已结束 → 等读协程收尾，返回 `format_bash_result(returncode, stdout_text, stderr_text)`，**不**产生任务。
   - 未结束且 `hard <= foreground_seconds`（且非 background）→ 已到总时长：`proc.kill()`，返回 `f"ERROR: command timeout after {int(hard)}s"`。
   - 未结束且 `running_count >= max_running` → `proc.kill()`，返回 `f"ERROR: too many background tasks (max {max_running}); stop one with task_kill first"`。
   - 否则转后台：`task_id = new_ulid()`；`tool_use_id = actor.adapter.ledger.latest_bound_event_id("bash_exec")`；创建 `<workdir>/.ma/tasks/`，打开 `<task_id>.log`（`utf-8`，追加写），把已缓冲的行全部写入并之后实时写入；`continuation.register_pending(f"task:{task_id}")`；`await actor.append([created_event])`（§6.1）；启动看护协程 `_watch(task_id, deadline=hard - elapsed)`；返回 §4.3.1 的文本。
7. `_watch`：等进程结束或到 deadline（到点 → kill，`state="failed"`，`error={"type":"timeout","message":f"task exceeded {int(hard)}s"}`）；结束时 `state = "succeeded" if rc == 0 else "failed"`，`failed` 时 `error={"type":"exit_code","message":f"exit code {rc}"}`；关闭日志；`stored = await actor.append([completed_event])`；`continuation.resolve_pending(f"task:{task_id}", WakeUp("task", stored[0]) if wake else None)`。被 `kill()` 结束时由 `kill` 负责落 `cancelled` 事件，`_watch` 检测到 `_Proc.cancelled` 已置位则不再重复落事件。
8. 任意分支都不得把 `prepared.env` 内容写进事件或日志。

`format_bash_result`（与 `agent_tools.py` L6565–6569 逐字一致，不含 HINT 段）：

```python
def format_bash_result(returncode: int | None, stdout: str, stderr: str) -> str:
    return (
        f"exit_code={returncode}\n"
        f"stdout:\n{stdout.strip() or '(empty)'}\n"
        f"stderr:\n{stderr.strip() or '(empty)'}"
    )
```

#### 4.3.1 转后台时返回给模型的文本（逐字模板）

```
task_id=<task_id>
status=running
NOTE: The command is still running and has been moved to a background task.
You will be notified automatically when it finishes. Do not poll in a loop.
Use task_get(task_id) to read output, or task_kill(task_id) to stop it.
partial_output:
<内存尾部最后 2000 字符，缺省为 (empty)>
```

#### 4.3.2 三个平台工具（schema 逐字）

```python
TASK_TOOL_SCHEMAS = [
  {"type": "function", "function": {
    "name": "task_list",
    "description": "List background tasks of this session (bash commands that were moved to the background).",
    "parameters": {"type": "object", "properties": {
      "state": {"type": "string", "enum": ["running", "all"], "description": "Default all."}},
      "required": []}}},
  {"type": "function", "function": {
    "name": "task_get",
    "description": "Get one background task with its latest output tail.",
    "parameters": {"type": "object", "properties": {
      "task_id": {"type": "string"},
      "max_output_chars": {"type": "integer", "minimum": 1, "maximum": 16000, "description": "Default 4000."}},
      "required": ["task_id"]}}},
  {"type": "function", "function": {
    "name": "task_kill",
    "description": "Stop a running background task.",
    "parameters": {"type": "object", "properties": {"task_id": {"type": "string"}}, "required": ["task_id"]}}},
]
```

返回值一律 `json.dumps(obj, ensure_ascii=False)`：
- `task_list` → `{"tasks": [record.to_wire(include_output=False), ...]}`，来源 = 本会话事件折叠（`fold_task_events`）叠加 `live_records()`，按 `created_at` 倒序；`state="running"` 时只留 running。
- `task_get` → `record.to_wire(include_output=True)`，`output` 截取尾部 `max_output_chars`（缺省 4000）；未知 id → `{"error": "task not found", "task_id": "<id>"}`。
- `task_kill` → `kill(task_id, error_type="killed_by_agent", message="stopped by task_kill", wake=False)` 后的 `record.to_wire(include_output=False)`；已结束 → 原记录；未知 → `{"error": "task not found", ...}`。

`kill(... wake=False)`：由 Agent 自己停掉的任务不再产生唤醒通知（它已经知道结果）。API 取消（§4.6）用 `wake=True`，让主线程知道任务被外部停止。

bash schema 补丁（`install` 内，只改 `bundle.tools` 中 `function.name == "bash_exec"` 的那一份副本）：
- `parameters.properties["run_in_background"] = {"type": "boolean", "description": "Start the command as a background task and return its task_id immediately."}`
- `description` 末尾追加一句：` Commands still running after 60 seconds are moved to a background task automatically.`（秒数取 `int(foreground_seconds)`）。
- 不存在 `bash_exec`（Manifest 未启用）时不追加 bash 覆盖，但 task_* 工具仍注入（无任务时返回空列表）。

### 4.4 `agenticx/managed/permissions.py`

1. `DecisionSource = Literal["custom", "manifest", "enterprise", "unlisted"]`（L25）改为追加 `"platform"`。
2. `PermissionEngine.__init__` 增加关键字参数 `platform_tools: frozenset[str] = frozenset()`，存 `self._platform_tools`。
3. `evaluate`：在企业 deny 判定之后、`entry = self._spec.tool(tool_name)` 之前插入：

```python
        if tool_name in self._platform_tools:
            return _decision("allow", "platform", tool_name, "platform tool injected by host")
```

`ManagedPermissionHook` 不改：`source != "custom"` 时照常 announce（kind builtin、`evaluated_policy="always_allow"`）并 grant。

### 4.5 `agenticx/managed/events/adapter.py`

`ToolUseLedger` 增加方法（不改其它方法）：

```python
    def latest_bound_event_id(self, name: str) -> str | None:
        """Event id of the most recently bound use with this name, finished or not."""
```

实现：维护 `self._bind_order: list[str]`（`bind` 成功时追加 `tool_call_id`），倒序找第一个 `name` 相同的 `_by_call[...]`。`parallel_tools` 开启时同名并发调用可能错配，任务的 `tool_use_id` 仅作展示用途（写进文档）。

### 4.6 `agenticx/managed/host/config.py`

`HostConfig` 在 `sse_ping_seconds` 之后追加（默认值逐字）：

```python
    tasks_enabled: bool = False
    task_foreground_seconds: float = 60.0
    task_max_runtime_seconds: float = 3600.0
    max_running_tasks: int = 8
```

### 4.7 `agenticx/managed/host/actor.py`

1. import 追加：`from agenticx.managed.host.continuation import TurnContinuation, WakeUp, wake_text`、`from agenticx.managed.host.platform_tools import PlatformToolResolver`、`from agenticx.managed.host.tasks import SessionTaskManager`。
2. `LocalTurnExecutor.__init__` 末尾追加：

```python
        cfg = actor.service.config
        self.continuation: TurnContinuation | None = None
        self.tasks: SessionTaskManager | None = None
        self.platform: PlatformToolResolver | None = None
        if getattr(cfg, "tasks_enabled", False) and actor.environment.type == "cloud":
            self.continuation = TurnContinuation()
            self.tasks = SessionTaskManager(
                actor=actor,
                continuation=self.continuation,
                foreground_seconds=cfg.task_foreground_seconds,
                max_runtime_seconds=cfg.task_max_runtime_seconds,
                max_running=cfg.max_running_tasks,
            )
```

3. `_ensure_bundle`（L324–365）：
   - `resolver = CustomToolResolver(...)` 之后：`self.platform = PlatformToolResolver(resolver)`。
   - `PermissionEngine(actor.spec, actor.service.config.enterprise_policy)` 改为 `PermissionEngine(actor.spec, actor.service.config.enterprise_policy, platform_tools=frozenset(TASK_TOOL_NAMES) if self.tasks is not None else frozenset())`。
   - `custom_tool_resolver=resolver` 改为 `custom_tool_resolver=self.platform`。
   - `self._bundle = ...build(...)` 之后：`if self.tasks is not None: self.tasks.install(self._bundle, self.platform)`；然后 `self._bundle.tools.extend(self.platform.schemas())`（`install` 只注册，不改工具表，追加统一在此一处做，便于 MA-A08 复用）。
   - 若 MA-A06 已实施（`_ensure_bundle` 里出现 `CompositeToolResolver([resolver, self._dynamic_resolver])` 与 `self._base_tools = list(self._bundle.tools)`）：把 `resolver` 换成 `self.platform` 放进 `CompositeToolResolver` 的第一个位置，并保证平台 schema 的 `extend` 发生在 `self._base_tools = ...` **之前**。以实际实现为准，实施前核对。
4. `submit_message`：在 `self._queue.append(message)` 之后追加 `if self.continuation is not None: self.continuation.poke()`。
5. `_start_locked`：`self._stop_requested = False` 之后追加 `if self.continuation is not None: self.continuation.reopen()`。
6. `_run` 拆成「单回合」+「循环」（行为在 `self.continuation is None` 时逐字等价于改前）：

Before（L367–412 要点）：

```python
    async def _run(self, message):
        try: bundle = ...; text = message_text(message); ...; async for event in bundle.run_turn(...): convert/append
             outcome = actor.adapter.finish_turn()
        except CancelledError: ... except Exception: ...
        async with actor.lock:
            await actor.finish_turn_locked(outcome)
            ...; self._task = None
            if self._queue: await self._start_locked(self._queue.popleft())
```

After：

```python
    async def _run_one(self, message: StoredEvent) -> TurnOutcome:
        """Old _run body up to (and including) computing ``outcome``. Unchanged except the input text."""
        # text: message_text(message) for user.message; wake_text(message) otherwise (unsupported=False)

    async def _run(self, message: StoredEvent) -> None:
        actor = self.actor
        outcome = await self._run_one(message)
        persisted = False
        while (
            self.continuation is not None
            and not self._stop_requested
            and outcome.stop_type == "end_turn"
            and self.continuation.has_pending
        ):
            if not persisted:
                await actor.append(outcome.events)
                await actor.sync_record(usage=outcome.usage)
                persisted = True
            nxt = await self._next_continuation_input()
            if nxt is None:
                continue          # loop condition re-checks stop flag / pending
            outcome = await self._run_one(nxt)
            persisted = False
        if self.tasks is not None and self.tasks.has_running():
            reason = "interrupted" if self._stop_requested else "session_stopped"
            await self.tasks.cancel_all(error_type=reason, message=f"task stopped: {reason}")
        if self.continuation is not None:
            self.continuation.close()
        final = outcome if not persisted else TurnOutcome(stop_type=outcome.stop_type, events=[], usage=outcome.usage)
        async with actor.lock:
            await actor.finish_turn_locked(final)
            ...  # unchanged tail: grace task cancel, self._task = None, start queued message

    async def _next_continuation_input(self) -> StoredEvent | None:
        async with self.actor.lock:
            if self._queue:
                msg = self._queue.popleft()
                await self.actor.service.store.mark_processed(
                    self.actor.tenant_id, self.actor.session_id, [msg.id], utc_now_iso()
                )
                return msg
        if self._stop_requested or self.continuation is None:
            return None
        wake = await self.continuation.wait()
        return None if wake is None else wake.event
```

注意：`while` 条件里在 `has_pending` 为 False 但 `_queue` 非空时不进入循环——排队的用户消息仍按改前逻辑在 `finish_turn_locked` 之后由 `_start_locked` 开新回合（会先 idle 再 running，与改前一致）。只有存在待处理任务时，排队消息才在同一 running 区间内被消费。

7. `interrupt`（L417–427）在 `self.actor.void_waiters()` 之后追加：

```python
        if self.continuation is not None:
            self.continuation.close()
        if self.tasks is not None:
            asyncio.create_task(self.tasks.cancel_all(error_type="interrupted", message="task stopped: interrupted"))
```

8. `close()`（L434–445）开头追加 `if self.tasks is not None: await self.tasks.close()`。

### 4.8 `agenticx/cli/agent_tools.py`（唯一改动，精确插入 4 行）

位置：`_dispatch_tool_async_unredacted` 中 `try:`（当前 L12927）的下一行、`if name in META_TOOL_NAMES:` 之前。插入：

```python
        managed_overrides = getattr(session, "managed_tool_overrides", None)
        if isinstance(managed_overrides, dict) and name in managed_overrides:
            return await managed_overrides[name](
                arguments, session, confirm_gate=gate, emit_event=event_callback
            )
```

- 个人模式的 `StudioSession` 没有该属性 → `getattr` 返回 None → 短路，行为不变。
- 覆盖分支位于企业 deny、意图拒绝、路径规则、共享写入保护**之后**（这些检查都在 `try:` 之前），安全检查不被绕过。
- 不得改动该函数其它任何行；改前改后对照逐行确认。

`agenticx/managed/host/tasks.py` 顶部 `from agenticx.cli.agent_tools import _bash_exec_prepare`（私有函数跨模块使用，原因：复用命令沙箱与确认逻辑，避免复制；在 import 行尾加英文注释 `# reuse sandbox + confirm semantics of bash_exec`）。

### 4.9 `agenticx/managed/host/service.py`

1. import 追加：`from agenticx.managed.host.tasks import TASK_EVENT_TYPES, TaskRecord, fold_task_events`、`from agenticx.managed.ids import new_ulid`（已有则复用）。
2. `startup()`（L79–98）循环体开头，在 `machine = SessionStateMachine(...)` 之前插入：

```python
            rows = await self._all_events(record.tenant_id, record.id, list(TASK_EVENT_TYPES))
            dangling = [r for r in fold_task_events(rows).values() if r.state == "unknown"]
            if dangling:
                await self.event_log.append(record.tenant_id, record.id, [
                    task_completed_event(r.task_id, state="failed", result=None,
                        error={"type": "host_restarted", "message": "task was lost by a host restart"},
                        duration_ms=0)
                    for r in dangling
                ])
```

`_all_events(tenant, sid, types)`：按 `after_seq` 分页 `store.list_events(..., limit=500, types=types)` 读全。`task_completed_event(task_id, *, state, summary="", result, error, duration_ms)` 是 `tasks.py` 导出的构造函数（重启补终态时 `summary` 取折叠出的 `r.summary`）（同时供 `_watch` / `kill` 使用），返回带新 ULID `id` 的 dict。

3. 新方法（都先 `await self.get_session(principal, session_id)` 做租户校验）：

```python
    async def list_tasks(self, principal, session_id, *, state: str | None, limit: int) -> list[TaskRecord]: ...
    async def get_task(self, principal, session_id, task_id) -> TaskRecord: ...      # 不存在 -> MAError(TASK_NOT_FOUND)
    async def cancel_task(self, principal, session_id, task_id) -> TaskRecord: ...
```

- 折叠事件后叠加 live：`actor = self._actors.get((tenant, sid))`；`executor = getattr(actor, "executor", None)`；`tasks = getattr(executor, "tasks", None)`；有则用 `tasks.live_record(id)` 覆盖 `state="running"` 与 `output`。
- `state` 过滤取值 `running|succeeded|failed|cancelled|unknown`，逗号分隔多值；非法值 → `MAError(INVALID_REQUEST, f"unknown task state {v}")`。
- 任务不存在 → `MAError(TASK_NOT_FOUND, "task not found")`。**新增错误码**：在 `agenticx/managed/errors.py` 末尾追加 `TASK_NOT_FOUND = MAErrorCode("task_not_found", 404)` 并加入 `ALL_ERROR_CODES`；TS `MA_ERROR_CODES` 同步追加 `task_not_found: 404`（MA-00 parity 测试 `test_constants_match_ts_source` 会检查）。此项须登记 master §12（会话面错误码新增）。
- `cancel_task`：live 且 running → `await tasks.kill(id, error_type="cancelled_by_api", message="cancelled via API", wake=True)`；否则返回当前记录（幂等，200）。

### 4.10 `agenticx/managed/host/routes.py`

在 `archive_session` 路由之前追加（鉴权写法与现有路由相同）：

```python
    @router.get("/sessions/{session_id}/tasks")
    async def list_tasks(session_id: str, request: Request,
                         state: str | None = Query(default=None),
                         limit: int = Query(default=20, ge=1, le=100)) -> dict[str, Any]:
        principal = await current_principal(request)
        require_scope(principal, "ma:sessions:read")
        records = await state.service.list_tasks(principal, session_id, state=state, limit=limit)
        return {"data": [r.to_wire(include_output=False) for r in records]}

    @router.get("/sessions/{session_id}/tasks/{task_id}")
    ...  # ma:sessions:read -> {"task": record.to_wire(include_output=True)}

    @router.post("/sessions/{session_id}/tasks/{task_id}/cancel")
    ...  # ma:sessions:write -> {"task": record.to_wire(include_output=False)}
```

注意参数名 `state` 与闭包里的 `state: MAHostState` 同名会遮蔽：路由函数里把查询参数命名为 `task_state: str | None = Query(default=None, alias="state")`。

### 4.11 `agenticx/managed/spec.py`

1. 新常量（`RESERVED_CUSTOM_INPUT_PROPERTIES` 之后）：`PLATFORM_TOOL_NAMES: tuple[str, ...] = ("task_list", "task_get", "task_kill")`，加入 `__all__`。MA-A08 会在此元组追加 `"list_agents", "send_to_agent", "advisor"`。
2. `_semantic_errors` 的 custom 分支在「conflicts with builtin tool」判断之后追加：

```python
            if name in PLATFORM_TOOL_NAMES:
                errors.append(f'manifest.tools[{index}].name: conflicts with platform tool "{name}"')
```

（仅 Python 编译期语义校验，与 `conflicts with builtin tool` 同层；TS 校验器不做，管理台保存时只做结构校验——与 A01 现状一致。）

### 4.12 `agenticx/cli/ma_commands.py`

`serve` 增加 `enable_tasks: bool = typer.Option(False, "--enable-tasks", help="Enable background tool tasks (MA-A09)")`，构造 `HostConfig` 处传 `tasks_enabled=enable_tasks`（只加这一个参数）。

### 4.13 agent-runtime

`ma_agent_runtime/config.py` `Settings` 增加字段与解析（与现有 `_raw` / 范围校验写法一致；非法值 → 启动时 `ValueError(f"{NAME}: ...")`）：

| 环境变量 | 字段 | 默认 | 取值 |
|---|---|---|---|
| `MA_RUNTIME_TASKS_ENABLED` | `tasks_enabled: bool` | `False` | 恰为 `"1"` 才启用 |
| `MA_RUNTIME_TASK_FOREGROUND_SECONDS` | `task_foreground_seconds: float` | `60` | 5–600 |
| `MA_RUNTIME_TASK_MAX_RUNTIME_SECONDS` | `task_max_runtime_seconds: float` | `3600` | 60–86400，且 ≥ foreground |
| `MA_RUNTIME_MAX_RUNNING_TASKS` | `max_running_tasks: int` | `8` | 1–32 |

`app.py` 中 `HostConfig(...)` 追加这四个关键字参数（只增参数，不改其它行）。

### 4.14 TS `enterprise/packages/core-api/src/managed-agents.ts`

- `SERVER_EVENT_TYPES` 末尾追加 `"session.task_created"`、`"session.task_completed"`（顺序与 Python 一致）。
- 新 interface：

```ts
export interface SessionTaskCreated extends EventBase {
  type: "session.task_created";
  task_id: string;
  tool: { name: string; tool_use_id?: string | null };
  summary: string;
  log_path?: string | null;
}
export interface SessionTaskCompleted extends EventBase {
  type: "session.task_completed";
  task_id: string;
  state: "succeeded" | "failed" | "cancelled";
  summary: string;
  result?: { status: "ok" | "error"; exit_code?: number | null; output: string } | null;
  error?: { type: string; message: string } | null;
  duration_ms: number;
}
```

- `ServerEvent` 联合追加两者；`MA_ERROR_CODES` 追加 `task_not_found: 404`。若文件内存在对 `ServerEvent["type"]` 的 `switch`，补分支，`default` 保持 `never` 检查。

---

## 5. Before / After（行为）

| 场景 | Before | After（`tasks_enabled=True`，cloud） |
|---|---|---|
| `bash_exec` 10 秒结束 | 返回 `exit_code=…` 文本 | 相同文本，无任务、无新事件 |
| `bash_exec` 运行 5 分钟、未给 `timeout_sec` | 30 秒被杀，`ERROR: command timeout after 30s` | 60 秒时转任务，模型拿到 `task_id` 文本；会话保持 running；结束时落 `session.task_completed` 并唤醒主线程开新回合 |
| `bash_exec(timeout_sec=20)` 运行 1 分钟 | 20 秒被杀 | 相同（D9） |
| 回合结束但任务未完 | 立即 `status_idle(end_turn)` | 不发 idle，等待；任务完成后继续；全部处理完才 idle |
| `user.interrupt` | 停当前回合 | 停回合 + 取消所有运行中任务（`cancelled`），之后到达的完成事件不唤醒 |
| `tasks_enabled=False`（默认） | — | 与 Before 逐字一致：无 task_* 工具、无覆盖属性、`continuation is None` |

---

## 6. 数据与协议

### 6.1 事件（运行时 → 客户端，落库占 seq，`thread_id` 恒为 null）

`session.task_created`：

```json
{"type": "session.task_created",
 "task_id": "01JB7Q6ZKX0Q3M5H8V2N4R6T8W",
 "tool": {"name": "bash_exec", "tool_use_id": "01JB7Q6Y..."},
 "summary": "pytest -q tests/",
 "log_path": ".ma/tasks/01JB7Q6ZKX0Q3M5H8V2N4R6T8W.log"}
```

`session.task_completed`：

```json
{"type": "session.task_completed",
 "task_id": "01JB7Q6ZKX0Q3M5H8V2N4R6T8W",
 "state": "failed",
 "summary": "pytest -q tests/",
 "result": {"status": "error", "exit_code": 1, "output": "...tail <= 8000 chars..."},
 "error": {"type": "exit_code", "message": "exit code 1"},
 "duration_ms": 183402}
```

Python 模型（`protocol.py`，与 `EventBase` 子类写法一致，`extra="forbid"`）：

```python
class TaskToolRef(_StrictModel):
    name: str
    tool_use_id: str | None = None

class TaskResult(_StrictModel):
    status: Literal["ok", "error"]
    exit_code: int | None = None
    output: str = ""

class TaskError(_StrictModel):
    type: str
    message: str

class SessionTaskCreated(EventBase):
    type: Literal["session.task_created"]
    task_id: str
    tool: TaskToolRef
    summary: str
    log_path: str | None = None

class SessionTaskCompleted(EventBase):
    type: Literal["session.task_completed"]
    task_id: str
    state: Literal["succeeded", "failed", "cancelled"]
    summary: str = ""
    result: TaskResult | None = None
    error: TaskError | None = None
    duration_ms: int = Field(default=0, ge=0)
```

`SERVER_EVENT_TYPES` 末尾追加两项；`ServerEvent` 联合追加两类。

`error.type` 取值（开放字符串，登记 master §12）：`exit_code`、`timeout`、`interrupted`、`session_stopped`、`session_closed`、`killed_by_agent`、`cancelled_by_api`、`host_restarted`。`result`：`succeeded` → `{"status":"ok", ...}`；`failed` 且进程有退出码 → `{"status":"error", ...}`；`cancelled` 与 `host_restarted` → `result` 可为 null。

### 6.2 任务状态（API 视图）

| state | 来源 |
|---|---|
| `running` | 本进程 live 记录 |
| `succeeded` / `failed` / `cancelled` | `session.task_completed.state` |
| `unknown` | 有 created、无 completed，且本进程无 live 记录（其它副本或刚重启尚未恢复） |

### 6.3 任务 JSON（`TaskRecord.to_wire`）

```json
{"task_id": "01J...", "session_id": "01J...", "thread_id": null,
 "tool": {"name": "bash_exec", "tool_use_id": "01J..."},
 "state": "running", "summary": "pytest -q tests/",
 "created_at": "2026-11-02T08:00:00.000Z", "finished_at": null,
 "log_path": ".ma/tasks/01J....log", "duration_ms": 0,
 "result": null, "error": null}
```

`include_output=True` 时 `result` 一定存在：running → `{"status": "ok", "exit_code": null, "output": "<live tail>"}`；结束 → 事件中的 `result`（null 时给 `{"status": "error", "exit_code": null, "output": ""}`）。`include_output=False` 时 `result` 里不含 `output` 键。

### 6.4 HTTP

| 方法 | 路径 | scope | 响应 |
|---|---|---|---|
| GET | `/ma/v1/sessions/{id}/tasks?state=running,failed&limit=20` | `ma:sessions:read` | 200 `{"data":[Task]}`（`created_at` 倒序；limit 1–100） |
| GET | `/ma/v1/sessions/{id}/tasks/{task_id}` | `ma:sessions:read` | 200 `{"task": Task(含 output)}`；404 `task_not_found` |
| POST | `/ma/v1/sessions/{id}/tasks/{task_id}/cancel` | `ma:sessions:write` | 200 `{"task": Task}`（已结束则原样，幂等）；404 `task_not_found` |

会话不存在 / 跨租户 → 404 `session_not_found`（复用 `get_session`）。nginx 现有 `location /ma/v1/` 已把这些路径分发到 agent-runtime（`enterprise/deploy/nginx/gateway.conf` L104），无需修改。

---

## 7. FR / NFR / AC

| ID | 需求 | AC（测试文件 :: 用例 :: 断言） |
|---|---|---|
| FR-1 | 唤醒原语 | `tests/managed/test_continuation.py::test_wait_returns_none_without_pending`（无 pending 立即 None，不阻塞：`asyncio.wait_for(..., 0.1)` 不超时）；`::test_resolve_with_wake_delivers_in_order`（两个 key 依次 resolve，`wait()` 依次返回对应 event）；`::test_poke_returns_none`；`::test_close_drops_late_wakes`（close 后 resolve 带 wake → `wait()` 返回 None 且 `has_pending` 为 False） |
| FR-2 | 平台工具组合解析 | `test_session_tasks.py::test_platform_resolver_prefers_platform_then_delegate`（注册 `task_list`；`resolve("task_list", __tool_call_id="c1", state="all")` 调到 handler 且 handler 收到的 arguments 不含 `__tool_call_id`、收到 `tool_call_id="c1"`；未注册名转 delegate；handler 抛 `RuntimeError("secret")` → 返回 `ERROR: tool task_list failed` 且不含 `secret`） |
| FR-3 | 权限 platform 来源 | `tests/managed/test_permissions.py::test_platform_tool_allowed_unless_enterprise_denied`（`platform_tools={"task_list"}`：`evaluate("task_list", {})` → `decision=="allow"`、`source=="platform"`；企业策略 deny `task_list` → deny、`source=="enterprise"`；未传 platform_tools → `unlisted`） |
| FR-4 | 前台结束不产生任务 | `test_session_tasks.py::test_short_command_returns_inline`（`foreground_seconds=2`，命令 `echo hi`：返回值以 `exit_code=0\nstdout:\nhi` 开头；会话事件中无 `session.task_*`） |
| FR-5 | 超时自动转后台 | `::test_long_command_moves_to_background`（`foreground_seconds=0.5`，命令 `sleep 2; echo done`：返回值第一行匹配 `^task_id=[0-9A-HJKMNP-TV-Z]{26}$`、含 `status=running`；随后出现一条 `session.task_created`（`tool.name=="bash_exec"`、`summary` 以 `sleep 2` 开头、`log_path` 以 `.ma/tasks/` 开头且文件存在）；约 2 秒后出现 `session.task_completed`（`state=="succeeded"`、`result.exit_code==0`、`result.output` 含 `done`）） |
| FR-6 | 显式后台 | `::test_run_in_background_true_returns_immediately`（`run_in_background=True`、`sleep 1`：调用耗时 < 0.5 秒并返回 task_id 文本） |
| FR-7 | 显式短超时保持原语义 | `::test_explicit_short_timeout_kills`（`foreground_seconds=5`、`timeout_sec=1`、`sleep 3` → 返回 `ERROR: command timeout after 1s`，无任务事件） |
| FR-8 | 并发上限 | `::test_running_task_limit`（`max_running=1`：第一个 `sleep 3` 转后台成功；第二个 `sleep 3` 到前台时限后返回 `ERROR: too many background tasks (max 1); stop one with task_kill first`） |
| FR-9 | 总时长 | `::test_background_task_timeout_fails`（`foreground_seconds=0.2`、`max_runtime_seconds=0.6`、`sleep 5` → `session.task_completed.state=="failed"`、`error.type=="timeout"`） |
| FR-10 | 会话保持 running 并被唤醒 | `test_session_tasks.py::test_session_stays_running_until_task_done`（用 `create_ma_app` + `PerSessionScriptFactory`，`HostConfig(tasks_enabled=True, task_foreground_seconds=0.3)`；脚本：step1 调 `bash_exec{"command":"sleep 1; echo ok"}`，step2 文本 `waiting`，step3 文本 `task finished`；断言事件顺序：`session.status_running` → … → `session.task_created` → `agent.message("waiting")` → `session.usage` → **无** `session.status_idle` → `session.task_completed` → `agent.message("task finished")` → `session.status_idle(end_turn)`；全程只有一条 `session.status_running`；第三次 LLM 调用的最后一条 user 消息以 `[background task notification]` 开头） |
| FR-11 | 中断取消任务 | `::test_interrupt_cancels_tasks_and_no_wake`（任务转后台后发 `user.interrupt` → 出现 `session.task_completed(state="cancelled", error.type="interrupted")`；会话 `status_idle(end_turn)`；之后 1 秒内无新的 `session.status_running`；`ps` 不再有该进程：断言 `proc.returncode is not None`） |
| FR-12 | 非 end_turn 结束时清理 | `::test_max_tool_rounds_cancels_tasks`（`max_tool_rounds=1`，第一轮转后台后触顶 → `session.task_completed.error.type=="session_stopped"` 出现在 `status_idle(max_tool_rounds)` 之前） |
| FR-13 | task_* 工具 | `::test_task_tools_list_get_kill`（task_list 返回含该 id 且 `state=="running"`；task_get 的 `result.output` 含已输出内容；task_kill 后返回 `state=="cancelled"`；task_kill 产生的 completed 事件不触发唤醒：之后无额外 LLM 调用） |
| FR-14 | HTTP 列表 / 详情 / 取消 | `tests/managed/test_task_routes.py::test_list_get_cancel`（列表 200、`data[0].task_id`；详情 200 含 `result.output`；取消 200 → `task.state=="cancelled"`；再次取消 200 且 state 不变；未知 id → 404 `task_not_found`；他租户 token → 404 `session_not_found`；只有 `ma:sessions:read` 的 token 调 cancel → 403 `forbidden_scope`；`state=bogus` → 400 `invalid_request`） |
| FR-15 | 重启补终态 | `::test_startup_marks_dangling_tasks_failed`（直接向 SQLite store 写 `session.task_created` 且会话 `status=running`，新建 app 并 `startup()` → 该任务出现 `session.task_completed(state="failed", error.type="host_restarted")`，且排在 `session.error(host_restarted)` 之前） |
| FR-16 | 协议双端一致 | `tests/managed/test_protocol.py` L110 样例补两项后通过；`test_fixture_parity.py::test_constants_match_ts_source` 通过（新事件类型与 `task_not_found` 出现在 TS 源码）；`managed-agents.test.ts` 新增 `server event types include task events` |
| FR-17 | 自定义工具重名 | `tests/managed/test_spec.py::test_custom_tool_conflicts_with_platform_tool`（custom 名 `task_list` → `MAError(manifest_invalid)`，`details.errors` 含 `manifest.tools[0].name: conflicts with platform tool "task_list"`） |
| FR-18 | agent-runtime 配置 | `enterprise/apps/agent-runtime/tests/test_config.py::test_task_settings_defaults_and_bounds`（缺省 False/60/3600/8；`MA_RUNTIME_TASKS_ENABLED=true` 仍为 False；`MA_RUNTIME_MAX_RUNNING_TASKS=0` → ValueError） |
| NFR-1 | 个人模式零影响 | `tests/test_agent_tools_managed_override.py::test_no_override_attribute_uses_builtin`（普通 `StudioSession` 调 `dispatch_tool_async("bash_exec", {"command":"echo x"})` 结果以 `exit_code=0` 开头，monkeypatch 的覆盖函数未被调用）；`::test_override_used_when_present`（`session.managed_tool_overrides={"bash_exec": fake}` → 返回 fake 的值；企业 deny `bash_exec` 时覆盖不被调用且返回企业拒绝文案） |
| NFR-2 | 开关关闭零影响 | `test_session_tasks.py::test_disabled_has_no_task_tools`（默认 HostConfig：LLM 收到的工具名集合不含 `task_list`，`bundle.session` 无 `managed_tool_overrides` 属性）；现有 `pytest tests/managed -q` 全绿 |
| NFR-3 | 不泄露环境 | `::test_task_events_do_not_contain_env`（`prepared.env` 注入 `AGX_SECRET_PROBE=s3cr3t-xyz` 并 `echo hi`：任务事件与日志文件中不出现 `s3cr3t-xyz`） |

集成测试一律 `AGX_EFFECT_GUARD=0`（契约备忘 MA-A03 测试提示），并用 `tmp_path` 作 `data_dir`；涉及 `sleep` 的用例总时长控制在 5 秒内。

---

## 8. 验证命令

```bash
cd /Users/damon/myWork/AgenticX
AGX_EFFECT_GUARD=0 pytest tests/managed/test_continuation.py tests/managed/test_session_tasks.py tests/managed/test_task_routes.py -q
pytest tests/managed -q
pytest tests/test_agent_tools_managed_override.py -q
pytest tests/test_studio_server.py -q   # 三个既有失败用例见契约备忘，不算回归
(cd enterprise/apps/agent-runtime && PYTHONPATH="/Users/damon/myWork/AgenticX:$PWD" pytest tests -q)
pnpm -C enterprise --filter @agenticx/core-api test
pnpm -C enterprise --filter @agenticx/core-api typecheck

# 冷启动 smoke（临时 HOME，见契约备忘全局规则）
TMPH=$(mktemp -d); HOME=$TMPH agx serve --host 127.0.0.1 --port 18765 &  sleep 40; \
  curl --noproxy '*' -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:18765/api/sessions; kill %1

# 托管宿主手工演示
D=$(mktemp -d); agx ma serve --dev --enable-tasks --data-dir "$D" --port 18092 --token dev-token &
# 建会话、发「运行 sleep 90; echo ok」，订阅 SSE：90 秒内看到 session.task_created，结束后看到 session.task_completed 与新的 agent.message
```

---

## 9. 回滚

- 开关：框架 `HostConfig.tasks_enabled`（默认 False）；agent-runtime `MA_RUNTIME_TASKS_ENABLED`（默认未设 = 关）；dev `agx ma serve` 不带 `--enable-tasks` 即关。关闭后：不创建 `TurnContinuation` / `SessionTaskManager`，`PlatformToolResolver` 无注册项（只转发自定义工具），不设 `managed_tool_overrides`，回合循环逐字退化为改前单回合。
- 代码回滚：删除 §3.1 新建文件，`git checkout` 修改文件。已写入的 `session.task_*` 事件保留；回滚后观测台按 `other` 显示，`GET /ma/v1/sessions/{id}/events?types=session.task_created` 会因未知类型返回 400（预期，回滚说明里写明）。

---

## 10. 不变量

1. Near 个人模式与 `agx serve`：`dispatch_tool_async` 对无 `managed_tool_overrides` 属性的会话行为不变；`_tool_bash_exec` / `bash_bg_*` 源码不变。
2. `agenticx/runtime/agent_runtime.py`、`state_machine.py`、`durable_jobs/*` 不变。
3. `tasks_enabled=False` 时托管会话的事件序列与改前逐条相同（`test_w1_gate_e2e.py`、`test_w1_gate_worker_e2e.py` 全绿）。
4. 每个 running 区间只有一条 `session.status_running` 与一条终结它的 `session.status_idle`。
5. `session.status_idle` 发出时，本会话不存在运行中的任务进程。
6. 事件与日志中不出现命令环境变量值。
7. `desktop_worker` 环境的 Worker 协议与事件不变。

---

## 11. 须登记 master §12 / 待用户确认

- **登记**：① MA-A09 不复用 `durable_jobs`，任务状态以 `session.task_created` / `session.task_completed` 事件为准、运行态在进程内（§2 D1），master §9 MA-A09 行措辞「`durable_jobs` 暴露为会话任务」相应改写；② `session.task_*` 冻结为这两种事件及 §6.1 字段；③ 新增会话面错误码 `task_not_found` 404（进 `ALL_ERROR_CODES` / `MA_ERROR_CODES`）；④ `session.task_completed.error.type` 取值清单；⑤ 平台工具概念（宿主注入、不在 Manifest、权限来源 `platform`、企业 deny 优先），首批 `task_list` / `task_get` / `task_kill`，MA-A08 追加三项；⑥ MA-A08 依赖本子规划（W6「全部可并行」改为 A09 先于 A08）。
- **待确认**：Q1 托管模式 `bash_exec` 缺省总时长从 30 秒改为 3600 秒（仅托管、仅开关开启时），是否接受；Q2 多副本下任务运行态不跨副本（§2 D13），是否接受为 v1 限制。
