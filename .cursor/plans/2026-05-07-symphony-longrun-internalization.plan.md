# Plan: 内化 OpenAI Symphony 关键机制至 AgenticX (`agenticx/longrun/`)

- **Plan-Id**: 2026-05-07-symphony-longrun-internalization
- **Owner**: Damon Li
- **Created**: 2026-05-07
- **状态**: Drafted (待启动 Phase 1)
- **关联调研**: `research/codedeepresearch/symphony/symphony_proposal.md` (v2)
- **关联 issue / 上游**: <https://github.com/openai/symphony>

---

## 1. 背景与目标

OpenAI Symphony 是一个 Elixir 实现的轻量编排服务，把 issue tracker 里的任务翻译成可重复执行的、隔离运行的智能体工作流，已在 OpenAI 内部用于驱动 Codex 长程实现。本 plan 的目标是把 Symphony 在**长程任务稳定性**上沉淀的最 generic 的几条核心原语吸收进 AgenticX，但**不**复刻其全部架构、不替换 AgenticX 既有模块、不绑定 Linear。

调研结论（详见 proposal v2）：
- AgenticX 已具备：元智能体 workspace (`agenticx/workspace/`)、分身持久化目录 (`agenticx/avatar/`)、声明式 hooks 系统 (`agenticx/hooks/`)、LLM 调用层 retry (`agenticx/runtime/llm_retry.py`)、调用模式 loop 检测 (`agenticx/runtime/loop_detector.py`)、cron 自动化 (`AutomationScheduler`)、子智能体并发管理 (`AgentTeamManager`)。
- AgenticX 真实缺少：**per-task 工作空间隔离**（含路径安全 + 生命周期 hooks）、**任务级 stall 检测**（时间维度）、**任务级 retry 语义**（continuation vs failure）、**精确 token 增量计数**、**统一长程编排器**。

本 plan 聚焦上述真实缺口，全部以新模块 `agenticx/longrun/` 落地，零回归现有路径。

---

## 2. Functional Requirements (FR)

- **FR-1**: 提供 `TaskWorkspace`，支持以 `task_id` 为单位创建隔离工作目录，强制路径必须严格位于 `task_workspaces` 根之下，拒绝越界路径、symlink 逃逸与 `workspace == root` 等异常。
- **FR-2**: 任务级生命周期 hooks 提供 `task_workspace:after_create` / `before_run` / `after_run` / `before_remove` 四个事件，**复用** `agenticx/hooks/` 注册中心，不另起一套。
- **FR-3**: 提供 `TaskRetryPolicy`，支持区分两种 delay 语义：`continuation`（默认 1s）与 `failure`（指数退避，可配置 `failure_base_sec` / `failure_multiplier` / `max_backoff_sec` / `max_attempts`）。
- **FR-4**: 提供 `TaskStallDetector`，基于 `time.monotonic()` 与 `last_activity` 实现时间维度 stall 检测；与 `loop_detector` 互补，不替代。
- **FR-5**: 提供 `TaskTokenAccountant`，使用 `last_reported` 模式做 token 增量累加，避免长程任务多次 usage 报告引发的双重计数。
- **FR-6**: 提供 `LongRunOrchestrator`，集成上述五个原语 + `TaskSource` 抽象 + `submit_to_team` 回调，使用 `PENDING / RUNNING / RETRY_QUEUED / DONE / FAILED` 五态状态机驱动任务全生命周期。
- **FR-7**: 提供 `TaskSource` 协议与两个内置实现：`CronSource`（适配现有 `AutomationScheduler`）与 `ManualSource`（HTTP/IPC enqueue）；Linear / Webhook 仅作为可选参考实现，不进入主路径。
- **FR-8**: 在 `AgentTeamManager` 增量新增 `submit_for_longrun(entry)` 方法，**非破坏性**新增，不修改任何现有 spawn / delegate API。
- **FR-9**: Studio 增量新增只读快照接口 `GET /api/longrun/state`，便于观测与调试。
- **FR-10**: 提供配置开关：`~/.agenticx/config.yaml` 的 `longrun.enabled` 与环境变量 `AGX_LONGRUN_ENABLED`，默认关闭。

## 3. Non-Functional Requirements (NFR)

- **NFR-1**: 零回归——`agenticx/workspace/`、`agenticx/avatar/`、`agenticx/hooks/`、`agenticx/runtime/llm_retry.py`、`loop_detector.py`、`AutomationScheduler`、`AgentTeamManager` 现有公共行为不得变更，现有冒烟/单元测试全部保持绿。
- **NFR-2**: 默认零开销——长程编排器默认关闭；关闭时 `agenticx/longrun/` 不被 import 到主请求路径。
- **NFR-3**: 模块边界清晰——所有新增代码集中在 `agenticx/longrun/`，仅在 `team_manager.py`、`hooks/registry.py`、`studio/server.py` 留最小适配补丁；其余模块零侵入。
- **NFR-4**: 测试覆盖——`agenticx/longrun/` 整体行覆盖率 ≥ 85%；含路径安全、状态机各分支、retry 边界、stall 阈值、token delta 防重的针对性测试。
- **NFR-5**: 文档与 ADR——proposal v2 与本 plan 一同入仓；正式落地后在 `docs/` 增加用户向使用指南。
- **NFR-6**: 单实例桌面端假设——本期不引入分布式队列、外部存储或跨进程协调；持久化重试队列列入未来扩展，不在本 plan 范围。

## 4. Acceptance Criteria (AC)

- **AC-1**: `tests/test_smoke_longrun_primitives.py` 全绿，覆盖 FR-1 ~ FR-5 的所有正常与异常路径。
- **AC-2**: `tests/test_longrun_orchestrator.py` 全绿，覆盖 FR-6 ~ FR-9 的端到端路径（cron 触发 → 隔离工作空间 → submit_to_team → 完成 / 失败 / 延续 / stall 重启）。
- **AC-3**: 现有 `tests/` 中涉及 `AutomationScheduler` / `AgentTeamManager` / `agenticx/hooks` / `llm_retry` / `loop_detector` 的全部测试在不传 `AGX_LONGRUN_ENABLED=1` 的默认情况下保持绿。
- **AC-4**: `AGX_LONGRUN_ENABLED=0`（默认）时，`agenticx serve` 启动后 `agenticx/longrun/orchestrator.py` 不被 import；`pytest --collect-only` 不出现额外耗时；Desktop 主路径行为完全不变。
- **AC-5**: `AGX_LONGRUN_ENABLED=1` 时，`GET /api/longrun/state` 返回包含 `running` / `retrying` / `done` 计数与每个 task 的 `state / attempt / tokens / workspace_path` 字段。
- **AC-6**: `task_workspace:*` 四个事件可通过 `~/.agenticx/hooks/` 下的 `HOOK.yaml`（声明式）与 Python handler 两种方式注册并触发，行为与现有 `agent:start` / `tool:before_call` 等事件一致。

---

## 5. 任务清单（按 Phase 拆分）

> 提交规范：每个 Phase 内的代码 commit 必须带 `Plan-Id: 2026-05-07-symphony-longrun-internalization` trailer + `Plan-File:` trailer + `Made-with: Damon Li`，使用 `/commit --spec=.cursor/plans/2026-05-07-symphony-longrun-internalization.plan.md` 自动注入。

### Phase 1 — Per-task workspace + 任务级 retry/stall 原语 (P0)
- [ ] **P1-T1**：扫描并确认 `agenticx/hooks/registry.py` 是否已具备统一 `dispatch_event(event, payload, cwd, timeout_sec)` 入口；若无则新增最小适配（仅暴露调度入口，不改注册逻辑）。
- [ ] **P1-T2**：实现 `agenticx/longrun/__init__.py` + `task_workspace.py`（含 `TaskWorkspaceConfig` / `TaskWorkspace` / `TaskWorkspaceSecurityError` / `TaskWorkspaceHookError`），Symphony 行号锚点：`workspace.ex:358-384`。
- [ ] **P1-T3**：实现 `agenticx/longrun/task_hooks.py`，封装 `dispatch_task_workspace_event(phase, ...)`。
- [ ] **P1-T4**：实现 `agenticx/longrun/retry_policy.py` `TaskRetryPolicy`，行号锚点：`orchestrator.ex:928-939`。
- [ ] **P1-T5**：实现 `agenticx/longrun/stall_detector.py` `TaskStallDetector`。
- [ ] **P1-T6**：实现 `agenticx/longrun/token_accountant.py` `TaskTokenAccountant`，行号锚点：`orchestrator.ex:1353-1405`。
- [ ] **P1-T7**：编写 `tests/test_smoke_longrun_primitives.py`：
  - `test_task_workspace_safety`（越界 / symlink 逃逸 / workspace==root）
  - `test_task_workspace_hooks`（after_create / before_run / after_run / before_remove 顺序与 fatal/non-fatal）
  - `test_retry_continuation`（attempt=1 + kind=continuation → 1.0s）
  - `test_retry_failure_backoff`（指数退避边界 + max_backoff_sec 截断）
  - `test_stall_detector`（threshold 内 / 外 / forget）
  - `test_token_accountant_no_double_count`（同 usage 重复 absorb 不递增 total）
- [ ] **P1-T8**：本地跑 `pytest tests/test_smoke_longrun_primitives.py -v` 全绿；本地跑 `pytest tests/test_smoke_*` 抽样确认零回归。
- [ ] **P1-T9**：commit + 更新 conclusion（`/update-conclusion --plan=...`）。

**Phase 1 验收**：AC-1 + AC-3 通过；AC-4 静态验证通过（无 import 副作用）。

### Phase 2 — LongRunOrchestrator + 任务源 + Studio 接入 (P0)
- [ ] **P2-T1**：实现 `agenticx/longrun/orchestrator.py` `LongRunOrchestrator` + `TaskState` + `TaskEntry` + `LongRunOrchestratorConfig`。
- [ ] **P2-T2**：实现 `agenticx/longrun/sources/__init__.py` + `cron_source.py`（适配现有 `AutomationScheduler`，不重写调度逻辑，只把已到期的 cron task 翻译为 `LongRunOrchestrator` 的 pending tasks）。
- [ ] **P2-T3**：实现 `agenticx/longrun/sources/manual_source.py`（提供进程内 `enqueue(payload)` 与已完成标记，便于 Studio HTTP 路由直接调用）。
- [ ] **P2-T4**：在 `agenticx/runtime/team_manager.py` 增量新增 `async def submit_for_longrun(self, entry) -> asyncio.Future`，将 `TaskEntry` 翻译为 `SubAgentContext`（带 `workspace_dir=entry.workspace.path`）并通过既有 spawn 路径执行；回调返回 `{"wants_continuation": bool, ...}`。
- [ ] **P2-T5**：在 `agenticx/studio/server.py` 增量新增 `GET /api/longrun/state`（只读）与 `POST /api/longrun/tasks`（手动 enqueue，需 `AGX_DESKTOP_TOKEN`）；通过 `AGX_LONGRUN_ENABLED` 控制路由是否注册。
- [ ] **P2-T6**：在 `~/.agenticx/config.yaml` 与 ConfigManager 增加 `longrun.*` 配置节读取；缺省安全。
- [ ] **P2-T7**：编写 `tests/test_longrun_orchestrator.py`：
  - `test_longrun_state_machine`（PENDING→RUNNING→DONE / RETRY_QUEUED→RUNNING→DONE / →FAILED）
  - `test_longrun_continuation_then_done`（首次完成 wants_continuation=True，第二次完成 wants_continuation=False）
  - `test_longrun_failure_then_recover`（首次抛异常进入 retry，第二次成功）
  - `test_longrun_stall_triggers_restart`（fake clock 推进到 stall 阈值后触发重启）
  - `test_longrun_no_regression_on_existing_paths`（不开启时 `AutomationScheduler` 行为完全一致）
- [ ] **P2-T8**：本地手工冒烟：开启 `AGX_LONGRUN_ENABLED=1`，用 `curl` enqueue 一个最小 task，确认隔离目录被创建、子智能体在该目录下执行、完成后状态正确写入。
- [ ] **P2-T9**：commit + 更新 conclusion。

**Phase 2 验收**：AC-2 + AC-3 + AC-4 + AC-5 + AC-6 全部通过；手工冒烟脚本结果落到 `research/codedeepresearch/symphony/longrun_smoke_2026-05-XX.md`。

### Phase 3 — 可选任务源参考实现 (P2，按需触发，非默认)
- [ ] **P3-T1**：`agenticx/longrun/sources/linear_source.py`（Linear GraphQL 轮询 + active/terminal states 配置）。
- [ ] **P3-T2**：`agenticx/longrun/sources/webhook_source.py`（FastAPI 子路由）。
- [ ] **P3-T3**：示例配置 `docs/examples/longrun-linear.yaml` + 用户文档 `docs/guides/longrun-task-sources.md`。
- [ ] **P3-T4**：`tests/test_longrun_sources_linear.py` mock GraphQL 响应做契约测试。

**Phase 3 验收**：参考实现可在 demo 仓库手工跑通；不向主仓默认依赖增加 `gql` / `httpx[graphql]` 等新依赖（如需则放 `pyproject.toml` 的 optional-dependencies 下）。

---

## 6. 风险与回滚

| 风险 | 概率 | 影响 | 缓解 |
|---|---|---|---|
| 路径安全校验疏漏，造成误删用户文件 | 中 | 高 | 三重校验（canonical 路径 + 前缀严格匹配 + workspace==root 拒绝）+ symlink 用例覆盖 + `cleanup_on_remove` 默认开启但可关闭 |
| 与 `AgentTeamManager` 现有并发上限或 owner_session_id 隔离冲突 | 中 | 中 | 全部走既有 spawn API；新增 `submit_for_longrun` 仅做翻译，不旁路 TeamManager 的限流与归档 |
| `agenticx/hooks/registry.py` 现状不支持统一 dispatch_event | 中 | 低 | Phase 1 第一步即扫描确认；如缺失则补一个最小薄适配（Author: Damon Li 头），不破坏现有 hook 注册 |
| 真实场景里 `wants_continuation` 语义被滥用导致死循环 | 中 | 中 | `TaskRetryPolicy.max_attempts` 强制截断 + `loop_detector` 仍可在子智能体侧报告饱和 |
| Studio `/api/longrun/state` 暴露敏感工作目录 | 低 | 中 | 路由复用 `requireDesktopToken` 同源认证；返回字段限定为 task_id / state / attempt / token 计数（不返回任意文件内容） |

**回滚策略**：
1. 关闭开关 `AGX_LONGRUN_ENABLED=0` 即可在不改代码的情况下完全停用编排器；`agenticx/longrun/` 模块不被 import。
2. 如需彻底移除：revert 涉及 `agenticx/longrun/`、`team_manager.py.submit_for_longrun`、`hooks/registry.py.dispatch_event`、`studio/server.py` 长程路由的 commits（Plan-Id 已 trailer 标记，便于聚合 revert）。
3. 数据清理：删除 `~/.agenticx/task-workspaces/` 即可，独立目录无关联数据。

---

## 7. 验证与度量

- **代码层度量**：`agenticx/longrun/` 行覆盖率 ≥ 85%（pytest-cov）；`mypy agenticx/longrun` 零报错；`ruff check agenticx/longrun` 零报错。
- **运行时度量**：`/api/longrun/state` 返回 `running / retrying / done / failed` 四类计数；每个 task 的 `attempt`、`elapsed_sec`、`tokens.input/output` 可读。
- **观测**：所有 `longrun.*` 日志使用结构化字段 `task_id` / `state` / `attempt` / `kind` / `delay_sec` / `elapsed_sec`，便于 jq 过滤。

---

## 8. 不在范围（明确否决）

- 完全复刻 Symphony 的 Elixir GenServer 进程模型（与 AgenticX 单实例 Python 桌面定位不符）。
- 引入 `WORKFLOW.md` 声明式任务 DSL（避免过早抽象，等 Phase 1/2 稳定后基于真实需求再定）。
- 强绑定 Linear / Jira（保持 `TaskSource` 抽象，参考实现仅作可选包）。
- 跨进程分布式执行 / 持久化重试队列 / SSH worker（与本期目标不符，列入未来扩展）。
- 替换或修改 `agenticx/workspace/loader.py`、`agenticx/avatar/registry.py`、`agenticx/runtime/llm_retry.py`、`loop_detector.py`、`AutomationScheduler` 等已有模块的语义。

---

## 9. 关联文件锚点

- 主调研报告：`research/codedeepresearch/symphony/symphony_proposal.md` (v2)
- 源码笔记：`research/codedeepresearch/symphony/symphony_source_notes.md`
- 差距分析：`research/codedeepresearch/symphony/symphony_agenticx_gap_analysis.md`
- Symphony 上游：`research/codedeepresearch/symphony/upstream/`
- 元信息：`research/codedeepresearch/symphony/meta.md`
- 现有 AgenticX 关键参照：
  - `agenticx/workspace/loader.py`
  - `agenticx/avatar/registry.py`
  - `agenticx/hooks/{registry,loader,bundled}/`
  - `agenticx/runtime/{team_manager,llm_retry,loop_detector,task_scheduler}.py`
  - `agenticx/studio/server.py`（`AutomationScheduler`）
