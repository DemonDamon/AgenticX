# AgenticX Long-Run 模块总结

> 结论生成时间：2026-05-29（首次创建，覆盖当前代码）

## 模块概述

AgenticX Long-Run 模块提供**长任务运行 / 续跑（continuation）编排原语**，设计灵感来自 OpenAI Symphony（工作区隔离、停滞检测、重试退避）。其核心是 `LongRunOrchestrator`：持续轮询多种任务源（手动队列、Cron 自动化任务、Linear Issue、项目特性列表），为每个任务创建隔离工作区并交由 `submit_fn` 执行，统一管理重试退避、续跑轮次、停滞检测与按任务的 Token 计量。模块以可选方式集成进 Studio（`agx serve`），由 `longrun.enabled` 或 `AGX_LONGRUN_ENABLED=1` 开关控制，并对外暴露受 Desktop Token 保护的 HTTP 路由。

## 目录结构

```
agenticx/longrun/
├── __init__.py            # 导出重试/停滞/工作区/计量原语
├── orchestrator.py        # LongRunOrchestrator 核心编排循环（轮询/分派/重试/停滞/快照）
├── retry_policy.py        # TaskRetryPolicy 续跑与失败退避策略
├── stall_detector.py      # TaskStallDetector 基于单调时钟的停滞检测
├── task_workspace.py      # TaskWorkspace 每任务隔离目录 + 安全不变量 + 生命周期钩子
├── token_accountant.py    # TaskTokenAccountant 按任务 Token 增量计量（防重复计数）
├── task_hooks.py          # task_workspace:<phase> 生命周期事件经 HookRegistry 派发
├── bootstrap.py           # Studio 启动时按开关挂载路由与轮询循环
├── studio_routes.py       # FastAPI 路由 + 任务源装配 + 后台轮询启动
└── sources/               # 任务源
    ├── __init__.py        # TaskSource Protocol + ComboTaskSource 多路复用
    ├── manual_source.py   # 手动 FIFO 队列（HTTP/webhook 入队）
    ├── cron_source.py     # 桥接 automation_tasks.json 的定时任务
    ├── linear_source.py   # 可选 Linear GraphQL 轮询源
    └── project_feature_source.py  # 项目特性列表只读源（feature_loop）
```

## 核心组件分析

### 编排器 (orchestrator.py)

**文件功能**：`LongRunOrchestrator` 是模块核心，封装“轮询任务源 → 隔离执行 → 重试/续跑/停滞处理”的完整生命周期。

**核心组件分析**：
- `TaskState` 枚举：pending / running / retry_queued / done / failed。
- `TaskEntry`：单任务运行态（payload、workspace、`failure_count`、`continuation_rounds`、`last_result`、内部 runner Task）。
- `LongRunOrchestratorConfig`：`poll_interval_sec`（默认 30s）、`retry_policy`、`workspace_config`、`stall_threshold_sec`（默认 300s）。
- `start_background()` / `stop()`：启停后台轮询任务（`_run_loop`）。
- `_tick()`：拉取待处理任务，去重后为每个新任务创建 `TaskWorkspace` 并 `_dispatch`。
- `_dispatch()` → 内部 `_run()`：执行 `submit_fn`，根据 `wants_continuation` 决定续跑或终结成功；区分 `CancelledError`（停止/停滞触发的失败重试）与普通异常（失败重试）；`finally` 执行 after-run 钩子。
- `_reconcile_stalls()`：对 running 任务用 `TaskStallDetector` 检查停滞，超阈值则取消 runner 并标记按失败重试。
- `_schedule_retry()`：失败路径累加 `failure_count` 并按退避延迟重排（达 `max_attempts` 则 FAILED）；续跑路径累加 `continuation_rounds`（达 `max_continuations` 则终结成功）。
- `_finalize_success()`：标记 DONE、清理停滞/Token 账本、移除工作区、回写任务源 `mark_task_done`。
- `snapshot()`：输出 running/retrying/done/failed 计数与逐任务详情（含 Token、年龄、尝试次数），供 HTTP 状态接口。

### 重试策略 (retry_policy.py)

**文件功能**：`TaskRetryPolicy` 区分续跑与失败两类延迟。续跑首轮固定短延迟（默认 1s）；失败采用指数退避（base 10s × 2^n，封顶 300s）。`max_attempts=0` 表示失败重试无限次；`max_continuations=64` 防续跑死循环。

### 停滞检测 (stall_detector.py)

**文件功能**：`TaskStallDetector` 基于 `time.monotonic` 记录每任务最近活动时间，`check()` 返回 `StallSnapshot`（含 `elapsed_sec` 与 `is_stalled`），超 `threshold_sec` 判定停滞。`touch()` / `forget()` 维护活动时间。

### 任务工作区 (task_workspace.py)

**文件功能**：`TaskWorkspace` 为每个逻辑 task_id 在 root 下分配一次性隔离目录（默认 `~/.agenticx/task-workspaces`）。

**安全不变量**（对齐 Symphony `workspace.ex`）：task_id 经正则净化为安全名（空则抛 `TaskWorkspaceSecurityError`）；解析后路径必须严格位于 root 之下且不等于 root，越界即拒绝。生命周期方法 `create` / `prepare_for_run` / `cleanup_after_run` / `remove` 分别派发 `after_create` / `before_run`（致命，失败抛错）/ `after_run` / `before_remove` 钩子，`remove` 在配置允许时 `rmtree` 清理目录。

### 生命周期钩子 (task_hooks.py)

**文件功能**：`dispatch_task_workspace_event()` 把 `task_workspace:<phase>` 同步派发到 `HookRegistry`，上下文携带 `cwd`/`workspace_path`/`timeout_sec`；`fatal=True` 时钩子失败抛 `TaskWorkspaceHookError`。

### Token 计量 (token_accountant.py)

**文件功能**：`TokenLedger` 以“最新累计值 - 上次上报值”的增量方式累加 Token（避免重复计数），`TaskTokenAccountant` 按 task_id 维护账本，提供 `absorb` / `snapshot` / `forget`。

### Studio 接线 (bootstrap.py + studio_routes.py)

**文件功能**：
- `bootstrap.py`：`longrun_runtime_enabled()` 判定开关；`maybe_start_longrun()` 启用时挂载路由与轮询循环；`resolve_longrun_workspace_root()` / `resolve_worker_session_id()` 解析工作区根与 worker 会话 id（默认 `__longrun_worker__`）。
- `studio_routes.py`：`attach_longrun()` 装配任务源（manual + cron 经 `ComboTaskSource`，配置了 `linear_api_key` 时追加 Linear），构造 `submit_fn`（在 worker session 的 team 上调 `submit_for_longrun`），并注册 `GET /api/longrun/state`、`POST /api/longrun/tasks`、`POST /api/longrun/webhook/enqueue` 三个受 `AGX_DESKTOP_TOKEN` 保护的路由。

### 任务源 (sources/)

- **TaskSource Protocol**：定义 `fetch_pending_tasks()` 与 `mark_task_done()`；`ComboTaskSource` 合并手动队列与 cron 行。
- **ManualSource**：内存 FIFO 队列，按已完成 id 过滤；供 HTTP/webhook 入队。
- **CronSource**：桥接 `automation_tasks.json`，仅拉取 `enabled` 且 `longrun_server_dispatch` 为真且到期（按 frequency 与最小间隔）的任务，完成后回写 `lastRunAt`/`lastRunStatus`。
- **LinearTaskSource**：可选，配置 API Key 时经 Linear GraphQL 拉取开放 Issue（`mark_task_done` 当前为 noop）。
- **ProjectFeatureSource**：从 `project_state` 存储只读地流出待处理特性（每次 tick 默认 1 个），任务携带 `feature_loop` 元数据；写操作由 worker session 内的 `feature_*` 工具单写。

## 设计模式

### 1. 生产者-消费者
任务源（生产者）持续产出任务，编排器（消费者）轮询拉取并执行。

### 2. 策略模式
`TaskRetryPolicy` 将续跑与失败的延迟计算策略化；任务源多实现可插拔。

### 3. 适配器 / 多路复用
`ComboTaskSource` 与 `_MergedLongRunSources` 把异构任务源（手动/Cron/Linear/项目特性）适配为统一 `TaskSource` 接口并去重合并。

### 4. 模板方法 + 钩子
`TaskWorkspace` 生命周期各阶段经 `HookRegistry` 派发 `task_workspace:<phase>` 事件，允许外部扩展介入。

### 5. 状态机
`TaskState` 在 pending → running → (retry_queued / done / failed) 间迁移，由编排器统一驱动。

## 技术亮点

1. **工作区隔离与安全护栏**：每任务独立一次性目录，路径解析强制位于 root 之下、不等于 root，防越界与误删。
2. **停滞自愈**：基于单调时钟检测长时间无进展任务，主动取消并按失败重试，避免任务“卡死”占用资源。
3. **续跑与失败双轨退避**：续跑短延迟快速推进、失败指数退避并设最大尝试/续跑上限，兼顾推进效率与防死循环。
4. **增量 Token 计量**：以增量差值累加，规避重复上报导致的重复计数。
5. **可选集成 + 鉴权**：通过开关挂载，HTTP 路由经 Desktop Token 保护，任务源可按配置增减。

## 应用场景

1. **服务器侧定时任务长跑**：将 `automation_tasks.json` 中标记 `longrun_server_dispatch` 的任务交由后台编排循环周期执行。
2. **外部工单驱动**：配置 Linear API Key 后拉取 Issue 作为长任务输入。
3. **项目特性流水线**：从 `project_state` 特性列表逐条派发到 `feature_loop` worker，实现特性级长跑闭环。
4. **手动 / Webhook 入队**：通过 HTTP 接口手动或批量入队长任务。

## 总结

Long-Run 模块以 `LongRunOrchestrator` 为核心，借鉴 OpenAI Symphony 的工作区隔离、停滞检测与重试退避思想，构建了一套可插拔任务源、续跑/失败双轨退避、按任务 Token 计量与生命周期钩子的长任务编排原语。它通过开关式集成进 Studio 并暴露受保护的 HTTP 接口，为定时任务、外部工单与项目特性流水线等场景提供了健壮的后台长跑能力。
