# Plan: Multica 长程任务可靠性内化（SubagentTaskStore + Inbox + Skill 注入约定）

- **Plan-Id**: 2026-05-12-multica-internalization
- **Owner**: Damon Li
- **Created**: 2026-05-12
- **状态**: Drafted（待 Damon review 后启动 Phase 1）
- **范式约束**：保持 AgenticX 现有 **Chat + 多窗格分身** 范式，**不引入 Issue/Board/Assignee 一等公民**
- **关联研究产物**（同目录）：
  - `research/codedeepresearch/multica/meta.md`
  - `research/codedeepresearch/multica/multica_deepwiki.md`
  - `research/codedeepresearch/multica/multica_source_notes.md`（含交叉校验表 C1–C20）
  - `research/codedeepresearch/multica/multica_agenticx_gap_analysis.md`（含与 ClawTeam 互补章节）
  - `research/codedeepresearch/multica/multica_proposal.md`
- **同源参考 plan**（避免 scope 重叠）：
  - `.cursor/plans/2026-05-08-toolcall-ux-and-longrun-stability.plan.md`（FR-8/9 actionable nudge 与本 plan 的 retry/blocker 路径正交互补）
  - `.cursor/plans/2026-05-11-long-horizon-goal-anchor.plan.md`（compactor 用户意图锚定，本 plan 不动 compactor）
  - `.cursor/plans/2026-05-07-symphony-longrun-internalization.plan.md`（长程稳定性总思路）
  - `.cursor/plans/2026-04-16-agent-heartbeat-recovery.plan.md`（agent heartbeat 已有部分恢复机制，本 plan 在其基础上构建持久化层）
  - **ClawTeam plan**（git worktree / 任务 DAG / 计划审批 / TOML 模板）：本 plan 显式不重复

---

## 1. 背景与目标

### 1.1 现象

AgenticX 在「**多智能体协同高效完成长程任务**」上目前存在 3 类工程化痛点（详见 `multica_proposal.md` §1.1）：

1. **进程崩溃 / 重启 → 子智能体任务全部丢失**：`AgentTeamManager._agents` 是进程内 `dict`，无持久化记录可恢复
2. **子智能体 hang / 长尾任务无三级超时保护**：仅有 `run_timeout_seconds` + LLM 心跳超时，缺 dispatched / queued / semantic_inactivity 等三级
3. **子智能体阻塞时无主动汇报渠道**：`awaiting_confirm` 之外没有「软阻塞」（如等待用户外部 OAuth、外部审批）通道

### 1.2 上游参考：Multica（已研究）

Multica（`https://github.com/multica-ai/multica`）虽然产品形态（Issue/Board/Web）与 AgenticX 不同，但其**任务可靠性引擎**显著领先：
- **PG `agent_task_queue`** 状态机（queued → dispatched → running → completed/failed/cancelled）
- **三级超时**（dispatched 5min / running 2.5h / queued 2h TTL）
- **Mid-flight session pin**（每轮 `UpdateAgentTaskSession` 持续刷新 session_id）
- **Poisoned session 排除**（`iteration_limit` / `agent_fallback_message` / `api_invalid_request` 三类双保险过滤）
- **自动重试 + reason 分类**（仅 `runtime_offline` / `runtime_recovery` / `timeout` 重试；`autopilot` 源不重试；max 2 次）
- **进程重启孤儿恢复**（`RecoverOrphanedTasksForRuntime`）
- **Inbox 异步通知**（仅人收，agent 不收）
- **Skill 注入到各 Provider Native 路径**（`.claude/skills/...` / `AGENTS.md` / `GEMINI.md`）

### 1.3 本 plan 的目标

**仅迁移 Multica 的「任务可靠性 + 异步通知 + skill 注入约定」三套机制**，**不引入 Issue/Board/Daemon/PG/11-CLI 适配器**。

**不动**：协作模式（10 种）、Workforce、真委派 `delegate_to_avatar`、PlanNotebook/SOPRegistry/DiscoveryBus、Skill 自动沉淀（`learning/`）、群聊、跨会话 FTS、cc-bridge 现有接入、`compactor.py`。

**只动**：
- `agenticx/runtime/team_manager.py`（增 store + sweeper 钩子，**不改现有公开 API 签名**）
- 新增 `agenticx/runtime/subagent_store/`
- 新增 `agenticx/inbox/` + Studio `/api/inbox/*`
- 新增 `agenticx/runtime/meta_tools.py::report_blocker`
- 新增 `agenticx/skills/inject.py`（写到 provider native 路径）
- `desktop/` 端 SettingsPanel 增 Automation/Runtime 滑块 + Inbox badge + Blocker 提示卡

---

## 2. 真实证据（Multica 源码 + AgenticX 现状）

### 2.1 Multica 源码证据（已交叉校验）

详见 `multica_source_notes.md` §2.4 交叉校验表 C1–C20。关键结论：

| ID | 结论 | 源码定位 |
|---|---|---|
| C2 | per-(issue, agent) 串行化 = `FOR UPDATE SKIP LOCKED` + `NOT EXISTS` 双重保险 | `server/pkg/db/queries/agent.sql::ClaimAgentTask` |
| C5 | Mid-flight pin 每轮 `UpdateAgentTaskSession` 刷新 session_id + work_dir | 同上 |
| C6 | Poisoned 排除：`failure_reason NOT IN (3 类)` + `ai_output NOT ILIKE '%api 400%'` | `agent.sql::GetLastTaskSession` |
| C7 | 三级超时由 `FailStaleTasks` + `ExpireStaleQueuedTasks` 两个 sweeper 实现 | `server/internal/maintenance/sweeper.go` |
| C8 | 自动重试 = `CreateRetryTask` 克隆 + reason 白名单 + `attempt < max_attempts` | `agent.sql::CreateRetryTask` |
| C13 | Inbox 在 SQL 多处硬编码 `recipient_type='member'`（agent 不收 inbox） | `server/pkg/db/queries/inbox.sql` |
| C16 | Skill 写到 provider native 路径（`.claude/skills/` / `AGENTS.md` / `GEMINI.md`） | `server/internal/daemon/execenv/runtime_config.go::buildClaudeSkillContent` 等 |

### 2.2 AgenticX 现状代码证据

| 现状 | 文件位置 |
|---|---|
| `_agents: dict` 进程内 | `agenticx/runtime/team_manager.py::AgentTeamManager.__init__` |
| `SpawnConfig.run_timeout_seconds` 唯一超时 | 同上 |
| 子任务靠 `asyncio.create_task` | `team_manager.py::spawn_subagent` |
| `delegate_to_avatar` 已是真委派（不动） | `agenticx/runtime/meta_tools.py` |
| `AGX_SUBAGENT_MIN_RUN_TIMEOUT_SECONDS` 仅做下限保护，无 dispatched / queued | 同上 |
| Skill 自动沉淀已落地（不动） | `agenticx/learning/` |
| Heartbeat 部分恢复机制已落地 | `.cursor/plans/2026-04-16-agent-heartbeat-recovery.plan.md` 提及 |

---

## 3. Functional Requirements (FR)

### Phase 1 — PoC（可行性验证，2 天）

**目标**：在不破坏现有 in-memory 路径前提下，新增 SQLite 持久化层 + 进程重启恢复，作为旁路写入路径。

- **FR-1**：新增 `agenticx/runtime/subagent_store/store.py`，定义：
  - `SubagentTaskState` enum: `QUEUED / DISPATCHED / RUNNING / COMPLETED / FAILED / CANCELLED`
  - `SubagentFailureReason` enum: `RUNTIME_RECOVERY / PROVIDER_503 / NETWORK_TRANSIENT / DISPATCH_TIMEOUT / ITERATION_LIMIT / TOOL_CALL_LIMIT / PROVIDER_400 / USER_CANCEL / POISONED`
  - `RETRYABLE_REASONS` 白名单（仅前 4 类）
  - `SubagentTaskRow` Pydantic 模型（task_id / avatar_id / owner_session_id / source_type / state / session_id / work_dir / attempt / max_attempts / parent_task_id / failure_reason / failure_summary / blocker_state / 4 个时间戳）
  - `SubagentTaskStore` Protocol + `SqliteSubagentTaskStore` 实现，存于 `~/.agenticx/subagent_tasks.db`，PRAGMA `journal_mode=WAL`
  - 实现方法：`enqueue` / `transition` / `update_session` / `get` / `get_last_session_for_avatar` / `list_in_states` / `recover_orphaned_after_restart` / `find_stale_dispatched` / `find_stale_running` / `find_expired_queued` / `cancel_by`

- **FR-2**：`agenticx/runtime/team_manager.py::AgentTeamManager.__init__` 增可选 `subagent_store: SubagentTaskStore | None = None` 参数；默认懒加载 SQLite 实现；`AGX_SUBAGENT_PERSISTENCE_ENABLED=0` 时不启用（退回纯 in-memory）。

- **FR-3**：`spawn_subagent` 改为：
  1. 先 `await store.enqueue(task)`（status=QUEUED）
  2. 启动 `asyncio.create_task` 时改 `await store.transition(task_id, DISPATCHED, dispatched_at=now())`
  3. `_run_subagent` 入口改 `await store.transition(task_id, RUNNING, started_at=now())`
  4. 成功 / 失败 / 取消时 `await store.transition(task_id, ..., finished_at=now())`
  - **关键约束**：现有公开 API（`spawn_subagent` 返回值、`AgentSnapshot` 形状、SSE 事件格式）**保持不变**——读路径仍走 in-memory `_agents`，DB 仅做写穿透镜像。

- **FR-4**：`AgentTeamManager.__init__` 启动时 fire-and-forget 调用 `recover_orphaned_after_restart()`：把所有 DB 中状态为 `DISPATCHED` 或 `RUNNING` 的 task 标 `FAILED + reason=RUNTIME_RECOVERY + finished_at=now()`，仅写 DB（不会立即触发重试，重试在 Phase 2 接入）。

### Phase 2 — MVP（P0 全部落地，5 天）

**目标**：完成「三级超时 / mid-flight pin / poisoned 排除 / 自动重试 / blocker 上报」5 套核心机制。

- **FR-5**：`SpawnConfig` 增 3 个可选字段（向后兼容默认值）：
  - `dispatch_timeout_seconds: int = 300`
  - `running_timeout_seconds_max: int = 9000`（2.5h，作为上限；现有 `run_timeout_seconds` 仍生效，取两者较小）
  - `queued_ttl_seconds: int = 7200`（2h）

- **FR-6**：新增后台 sweeper，`AgentTeamManager.__init__` 启动 `asyncio.create_task(self._run_sweepers())`，循环间隔默认 30s：
  - `find_stale_dispatched(>dispatch_timeout_seconds)` → fail with `DISPATCH_TIMEOUT`
  - `find_stale_running(>running_timeout_seconds_max)` → fail with `RUNTIME_RECOVERY`
  - `find_expired_queued(>queued_ttl_seconds)` → fail with `DISPATCH_TIMEOUT`（不重试，因为没人消费已超 2h）
  - 每次 fail 后调 `_fail_and_maybe_retry(task, reason, summary)`

- **FR-7**：`AgentRuntime.run_turn`（或调用方）每轮拿到 LLM 返回的 `session_id` 后通过新增回调 `on_session_assigned: Optional[Callable[[str], Awaitable[None]]]` 通知上层；`team_manager._run_subagent` 注入此回调 → `await store.update_session(task_id, session_id)`。
  - 实现要点：尽量减少 `agent_runtime.py` 改动面，只新增可选回调参数，默认 None 时无副作用。

- **FR-8**：`_fail_and_maybe_retry(task, reason, summary)`：
  1. `await store.transition(task.task_id, FAILED, failure_reason=reason, failure_summary=summary, finished_at=now())`
  2. 判断是否重试：
     - `reason in RETRYABLE_REASONS` ✓
     - `task.attempt + 1 < task.max_attempts` ✓
     - `not task.source_type.startswith('automation')` ✓
     - `AGX_SUBAGENT_AUTO_RETRY_ENABLED != '0'` ✓
  3. 通过：`prior_session = await store.get_last_session_for_avatar(task.avatar_id, exclude_poisoned=True)`
  4. 调 `spawn_subagent(..., _parent_task_id=task.task_id, _attempt=task.attempt+1, _resume_session_id=prior_session)`
  5. 重试启动后通过 SSE 推送 `subagent_retry_scheduled` 事件

- **FR-9**：`get_last_session_for_avatar(exclude_poisoned=True)` 实现 poisoned 排除：
  - 跳过 `failure_reason IN (ITERATION_LIMIT, TOOL_CALL_LIMIT, PROVIDER_400, POISONED)` 的 session_id
  - 优先返回最近一次 `state=COMPLETED` 或可重试 fail 的 session_id
  - 全部都被毒污染时返回 `None`（重试不带 resume，从全新 session 开始）

- **FR-10**：新增 Meta-only 工具 `report_blocker(reason: str, suggested_action: str, severity: Literal['info','warn','block']='warn')`：
  - 仅在 subagent context 内可调用（顶层 Meta 调用直接报错）
  - 写入 `task.blocker_state` JSONB
  - 通过 SSE 向 `owner_session_id` 推送 `subagent_blocker` 事件
  - 写入 inbox（依赖 Phase 3 的 inbox 模块；Phase 2 仅打日志，Phase 3 接入完整 inbox）
  - 注册到 `agenticx/cli/agent_tools.py::STUDIO_TOOLS`

- **FR-11**：扩展 `runtime/event_protocol.py`，新增 4 类 SSE 事件：
  - `subagent_state_changed`（payload: task_id / avatar_id / from_state / to_state）
  - `subagent_blocker`（payload: task_id / avatar_id / reason / suggested_action / severity）
  - `subagent_retry_scheduled`（payload: parent_task_id / new_task_id / attempt / max_attempts / prior_session_id）
  - `inbox_item_created`（payload: item_id / type / severity / title）—— Phase 3 真正使用，Phase 2 先定义事件类型避免后续兼容性问题

- **FR-12**：Desktop 端 `ChatPane` 监听 `subagent_blocker` SSE，复用 `ProgressCard` 样式渲染「需要你输入」强提示卡（含 reason / suggested_action / 跳转到对应分身窗格按钮）；监听 `subagent_retry_scheduled` 在子智能体侧栏显示「自动重试 attempt N/M」徽章（与现有 retry 按钮对齐）。

- **FR-13**：Desktop SettingsPanel → Automation/Runtime 区块新增 3 个滑块（值映射到 `~/.agenticx/config.yaml` 的 `runtime.subagent_dispatch_timeout` / `runtime.subagent_running_timeout_max` / `runtime.subagent_queued_ttl`）；同一 tab 增「子智能体超时」分组；与现有 `runtime.max_tool_rounds` 滑块同位。

### Phase 3 — 稳定化（P1 + P2，5 天）

- **FR-14**：新增 `agenticx/inbox/store.py`：`InboxItem` 模型 + `SqliteInboxStore`（存于 `~/.agenticx/inbox.db`），方法 `create / list_unread / mark_read / archive / unread_count / list_paginated`。

- **FR-15**：Studio Server 暴露：
  - `GET /api/inbox`（支持 `unread_only` / `limit` / `offset`）
  - `POST /api/inbox/<id>/read`
  - `POST /api/inbox/<id>/archive`
  - `GET /api/inbox/unread_count`
  - SSE `inbox_item_created` 接入

- **FR-16**：4 个 inbox 触发点接入：
  - `subagent_blocker`（FR-10 调用 inbox.create）
  - `subagent_failed`（FR-8 中 fail 但**不**重试的分支 + 重试达上限的分支）
  - `automation_paused`（FR-17）
  - `subagent_completed`（仅当任务运行时长 > 5min 时；阈值 env `AGX_INBOX_LONG_TASK_THRESHOLD_SECONDS=300`）

- **FR-17**：`automation/scheduler.py` 增 `_check_failure_rate(automation_id)`：
  - 连续失败 ≥ N 次（默认 5，env `AGX_AUTOMATION_FAILURE_THRESHOLD=5`）
  - 或 24h 失败率 > 80%（计算窗口内 attempt total ≥ 5）
  - 满足任一 → 写入 `~/.agenticx/automation_paused.json` + 跳过下次调度 + inbox 写入 `automation_paused`
  - 用户在 Desktop UI 手动恢复（写入 `automation_resumed`）后清除 paused 标记

- **FR-18**：`spawn_subagent` 入口前置 admission gate `_check_provider_health(provider, model)`：
  - 复用 SettingsPanel 已有 provider 健康检查数据（绿/红状态点）；缺失时退化为本地 5min TTL cache + 实际 ping `{provider_base_url}/models`
  - provider 不可用 → 直接 `await store.enqueue + transition(FAILED, reason=PROVIDER_503)` + 抛 `SpawnRejected` 异常给调用方
  - env `AGX_SUBAGENT_ADMISSION_GATE_ENABLED=0` 关闭

- **FR-19**：批量取消接口（5 种）：
  - `cancel_by_avatar(avatar_id)`：删除分身时调用
  - `cancel_by_owner_session(session_id)`：删除 session 时调用
  - `cancel_by_source(source_type, source_id)`：取消 automation 时调用
  - `cancel_by_parent_task(parent_task_id)`：父任务被取消时连带子任务
  - 现有 `cancel_subagent(task_id)`：单个保留
  - 所有 cancel 都写 store + 推送 SSE + 中断对应 asyncio.Task

- **FR-20**：Per-task 工作目录隔离：
  - `team_manager.py::_build_isolated_session` 增 `task_dir = ~/.agenticx/avatars/<id>/tasks/<task_id>/workdir/`
  - 写入 `subagent_tasks.work_dir` 字段
  - `bash_exec` / `file_write` / `file_edit` 工具的默认 cwd 切到该目录（**仅默认 cwd**，绝对路径与显式 `cwd` 参数仍生效，不破坏 `@file` 引用契约）
  - 任务完成 N 天后（默认 7，env `AGX_TASK_DIR_GC_DAYS=7`）GC 删除

- **FR-21**：新增 `agenticx/skills/inject.py::inject_skills_to_provider_path(provider, workdir, skills)`：
  - Claude Code → 写到 `<workdir>/.claude/skills/<name>/SKILL.md`
  - Cursor → 写到 `<workdir>/.cursor/skills/<name>/SKILL.md`
  - Codex / Gemini → 写到 `<workdir>/AGENTS.md` / `<workdir>/GEMINI.md`（合并所有 skill 内容）
  - cc-bridge / claude-code session 启动前调用
  - 已有同名文件时备份到 `.backup/`（INV-8）
  - env `AGX_SKILL_AUTO_INJECT_ENABLED=0` 关闭

- **FR-22**：`agenticx/extensions/installer.py` 增 `install_with_lock`：
  - 安装 ClawHub / 外部 skill 时写入 `~/.agenticx/skills.lock.json`（格式参考 multica `skills-lock.json`：`{version, skills: {<name>: {source, sourceType, computedHash}}}`）
  - 后续启动时校验 hash 不匹配则警告

- **FR-23**：Desktop SettingsPanel 增「Skill Usage」tab，渲染 `skill_usage_tracker.py` 已有数据（每个 skill 30 天使用次数 + 成功率 + 最近使用 session）。

---

## 4. Non-Functional Requirements (NFR)

- **NFR-1**：所有新机制必须有 env flag 一键回退（`AGX_SUBAGENT_PERSISTENCE_ENABLED` / `AGX_SUBAGENT_AUTO_RETRY_ENABLED` / `AGX_SUBAGENT_ADMISSION_GATE_ENABLED` / `AGX_INBOX_ENABLED` / `AGX_SKILL_AUTO_INJECT_ENABLED` / `AGX_AUTOMATION_FAILURE_PAUSE_ENABLED`），出现问题可降级到旧 in-memory 模式。

- **NFR-2**：性能：spawn → enqueue → DISPATCHED 全链路 < 100ms（SQLite 单写）；sweeper 后台 task 常驻内存 < 5MB；每 1000 任务 SQLite 文件 < 5MB。

- **NFR-3**：DB 隔离：`subagent_tasks.db` 独立文件，不与 `~/.agenticx/memory/sessions.sqlite`、`~/.agenticx/inbox.db` 共表；PRAGMA `journal_mode=WAL` 防 IO 竞争。

- **NFR-4**：状态机原子性：所有 `state` 转换必须经 `store.transition()` 方法；该方法用 `BEGIN IMMEDIATE` 短事务（INV-6），sweeper 与主路径并发写不死锁。

- **NFR-5**：Cross-platform：所有路径用 `pathlib.Path` 与 `~/.agenticx/`（用户目录）；Windows 兼容（避免 `/tmp` / Unix-only fs flag）。

- **NFR-6**：可观测：所有 store 操作 log 结构化字段 `task_id` / `state_from` / `state_to` / `failure_reason` / `attempt`；SettingsPanel 增「子智能体任务历史」视图（按 avatar / state / failure_reason 筛选 + 7 天内时间线）。

- **NFR-7**：现有功能零回归（Chat / 群聊 / spawn / delegate_to_avatar / Workforce / Skill 自动沉淀 / 跨会话 FTS / cc-bridge / 多窗格 / 历史会话）。

- **NFR-8**：现有 `spawn_subagent` / `delegate_to_avatar` / `cancel_subagent` 等公开 API 签名兼容；新增字段都是 keyword-only + 默认值。

- **NFR-9**：Inbox 不与 Desktop toast 重复噪音：toast 仅承载即时反馈（如保存成功），inbox 仅承载离线-跨窗格-需跟进的事件（4 类 type 严格枚举）。

- **NFR-10**：与 ClawTeam plan（git worktree / DAG / 审批 / TOML 模板）无 scope 重叠；二者协调点仅在 worktree + per-task workdir 协议（FR-20 留 hook 但不强依赖）。

---

## 5. Acceptance Criteria (AC)

### Phase 1 (PoC) AC

- **AC-1.1**：spawn 一个长跑子智能体（mock LLM 持续 30s）→ SQLite `subagent_tasks` 表立即有该 task_id 行 + state=DISPATCHED → RUNNING；asyncio.kill 进程后重启 → 该行被标 FAILED + reason=RUNTIME_RECOVERY。
- **AC-1.2**：现有 5+ 集成测试（spawn / delegate / cancel / 群聊 / Workforce）全部通过零回归。
- **AC-1.3**：`AGX_SUBAGENT_PERSISTENCE_ENABLED=0` 时 SQLite 文件不被创建，仅走 in-memory 路径。

### Phase 2 (MVP) AC

- **AC-2.1**：子智能体 dispatched 后 hang（`asyncio.sleep(infinite)`） → 5min 后被 sweeper fail with DISPATCH_TIMEOUT → 自动重试 1 次 → 仍 hang → fail → 写入 inbox 告警。
- **AC-2.2**：mock LLM 第 1 轮返回 session_id=A → 第 2 轮返回 session_id=B → DB 中 `session_id` 字段被刷为 B；进程崩溃后重启重试时 `_resume_session_id=B`。
- **AC-2.3**：mock LLM 触发 ITERATION_LIMIT 失败 → DB 中 session_id=X 标 poisoned → 下次自动重试时 `_resume_session_id != X`。
- **AC-2.4**：`source_type='automation:foo'` 任务 fail with PROVIDER_503 → 不重试（INV-4）；其他源同 reason → 重试 1 次。
- **AC-2.5**：Meta 子智能体调 `report_blocker(reason='等待用户授权', suggested_action='打开 https://...')` → 主对话窗格 1s 内出现「需要你输入」强提示卡（含按钮跳转到分身窗格）；DB 中该 task 行 `blocker_state` 字段被填充。
- **AC-2.6**：Desktop SettingsPanel 「子智能体超时」3 个滑块调整后写入 `config.yaml`，下次 spawn 生效。

### Phase 3 (稳定化) AC

- **AC-3.1**：连续 5 次失败的 `automation:foo` 任务自动 pause + inbox 出现 `automation_paused` 项；用户 UI 手动恢复后下次调度恢复。
- **AC-3.2**：spawn 一个 provider 已离线的子智能体 → 立即抛 SpawnRejected 异常 + DB 写 FAILED + reason=PROVIDER_503，不阻塞主进程。
- **AC-3.3**：删除分身 → 该分身所有 queued/dispatched/running 任务被 cancel + asyncio.Task 被中断。
- **AC-3.4**：spawn 启动 cc-bridge session → workdir 下出现 `.claude/skills/<active_skill>/SKILL.md` 文件 + 内容来自 `~/.agenticx/skills/<active_skill>/SKILL.md`。
- **AC-3.5**：通过 ClawHub 安装 1 个外部 skill → `~/.agenticx/skills.lock.json` 出现该 skill 的 hash 记录。
- **AC-3.6**：Desktop SettingsPanel 「Skill Usage」 tab 显示每个 skill 30 天使用次数 + 成功率（数据来自 `skill_usage_tracker.py`）。

---

## 6. Implementation Phases / 任务清单

### Phase 1：PoC（2 天，可独立验收）

- [ ] **T-1.1**：创建 `agenticx/runtime/subagent_store/__init__.py` + `store.py`，定义 enum / Pydantic 模型 / Protocol（无实现）
- [ ] **T-1.2**：实现 `SqliteSubagentTaskStore`，PRAGMA WAL，建表 SQL
- [ ] **T-1.3**：单元测试 `tests/test_subagent_store.py`：T-1（test_persist_on_spawn）+ T-2（test_recover_orphaned）
- [ ] **T-1.4**：`AgentTeamManager.__init__` 增 `subagent_store` 可选参数 + 启动时调 `recover_orphaned_after_restart`
- [ ] **T-1.5**：`spawn_subagent` 旁路写 store（不改读路径）
- [ ] **T-1.6**：`AGX_SUBAGENT_PERSISTENCE_ENABLED` env flag（默认 ON）
- [ ] **T-1.7**：跑现有 spawn / delegate / cancel / 群聊 / Workforce 的所有集成测试，确认零回归

### Phase 2：MVP（5 天）

- [ ] **T-2.1**：扩展 `SubagentTaskStore` 加 `find_stale_dispatched / find_stale_running / find_expired_queued / get_last_session_for_avatar / update_session`
- [ ] **T-2.2**：`SpawnConfig` 增 3 个超时字段
- [ ] **T-2.3**：`AgentTeamManager._run_sweepers()` + `_fail_and_maybe_retry()` 实现
- [ ] **T-2.4**：`AgentRuntime.run_turn` 接 `on_session_assigned` 回调（最小改动面）
- [ ] **T-2.5**：`team_manager._run_subagent` 注入 `on_session_assigned` → `store.update_session`
- [ ] **T-2.6**：`agent_tools.py::report_blocker` Meta-only 工具
- [ ] **T-2.7**：`event_protocol.py` 4 类新事件 + SSE 推送接入
- [ ] **T-2.8**：`AGX_SUBAGENT_AUTO_RETRY_ENABLED` env flag（默认 ON）
- [ ] **T-2.9**：Desktop ChatPane 监听 `subagent_blocker` 渲染 ProgressCard 强提示
- [ ] **T-2.10**：Desktop ChatPane 监听 `subagent_retry_scheduled` 渲染重试徽章
- [ ] **T-2.11**：Desktop SettingsPanel 「子智能体超时」3 个滑块（写入 config.yaml）
- [ ] **T-2.12**：集成测试：T-3 / T-4 / T-5 / T-6 / T-7 / T-8 / T-9 / T-10 / T-11
- [ ] **T-2.13**：手动验收 Desktop 上的 AC-2.5 / AC-2.6（截图归档到 `.cursor/plans/screenshots/`）

### Phase 3：稳定化（5 天）

- [ ] **T-3.1**：新建 `agenticx/inbox/__init__.py` + `store.py` + `SqliteInboxStore`
- [ ] **T-3.2**：Studio Server 4 个 `/api/inbox/*` 端点 + SSE `inbox_item_created` 接入
- [ ] **T-3.3**：4 个 inbox 触发点接入（FR-16）
- [ ] **T-3.4**：`automation/scheduler.py::_check_failure_rate` 实现 + `~/.agenticx/automation_paused.json` 持久化
- [ ] **T-3.5**：`spawn_subagent` 前置 `_check_provider_health` admission gate + `AGX_SUBAGENT_ADMISSION_GATE_ENABLED` env flag
- [ ] **T-3.6**：批量取消 5 种入口（FR-19）+ Desktop 删除分身 / 取消 automation 时联动调用
- [ ] **T-3.7**：Per-task 工作目录隔离（FR-20）+ GC（默认 7 天）
- [ ] **T-3.8**：`agenticx/skills/inject.py` + cc-bridge 启动前调用
- [ ] **T-3.9**：`agenticx/extensions/installer.py::install_with_lock` + `~/.agenticx/skills.lock.json`
- [ ] **T-3.10**：Desktop SettingsPanel 「Skill Usage」 tab + 顶栏 Inbox badge + Inbox 抽屉 UI
- [ ] **T-3.11**：集成测试：T-12 / T-13 / T-14 / T-15
- [ ] **T-3.12**：手动验收 Desktop 上的 AC-3.* 全部（截图归档）
- [ ] **T-3.13**：更新 AGENTS.md `Learned Workspace Facts` 增加本提案落地后的相关事实

### 总工时

| 阶段 | 工时 | 关键风险 |
|------|------|---------|
| Phase 1 PoC | 2 天 | SQLite schema 与现有 sessions.sqlite 共存 |
| Phase 2 MVP | 5 天 | sweeper 与 asyncio task 生命周期协调；on_session_assigned 改动面控制 |
| Phase 3 稳定化 | 5 天 | Inbox UI 与 toast 不重复；Skill 注入路径不覆盖用户文件 |
| **合计** | **12 天** | 单人推进 |

---

## 7. Risks

详见 `multica_proposal.md` §7.1，关键风险表：

| # | 风险 | 严重性 | 缓解 |
|---|------|------|------|
| R1 | SQLite 写入与 messages.json 写入竞争 IO | 中 | 独立 DB 文件 + WAL 模式 |
| R2 | 自动重试放大 LLM 成本 | 中 | INV-4 + RETRYABLE_REASONS 严格白名单 + 全局 env 开关 |
| R3 | 三级超时阈值不合理 | 低 | SettingsPanel 暴露 + config.yaml 可配 |
| R4 | Inbox 与 toast 重复噪音 | 中 | inbox 仅 4 type；toast 仅承载即时反馈 |
| R5 | Per-task workdir 破坏 `@file` 绝对路径契约 | 低 | 仅默认 cwd 切换；绝对路径仍生效 |
| R6 | Sweeper 与 asyncio.Task 死锁 | 高 | `BEGIN IMMEDIATE` 短事务 + sweeper 用 `asyncio.create_task` |
| R7 | 与「automation 专属隔离」规则冲突 | 中 | task store 的 `owner_session_id` 严格按窗格 avatar_id 隔离查询 |
| R8 | Skill inject 写到 `.claude/skills/` 覆盖用户文件 | 低 | INV-8：先备份到 `.backup/` |
| R9 | `on_session_assigned` 改 `agent_runtime.py` 引入回归 | 中 | 严格新增可选参数；默认 None 时无副作用；先在测试环境跑 1 周 |

---

## 8. Out of scope（本 plan 明确不做）

详见 `multica_agenticx_gap_analysis.md` §4 NOT-DO 清单 + §6 与 ClawTeam 互补章节：

| # | 项 | 理由 |
|---|---|------|
| OOS-1 | Issue / Board / Assignee 一等公民 | 用户已确认范式不变 |
| OOS-2 | 11 个 coding agent CLI 大爆炸式适配 | cc-bridge 已覆盖；其他按需逐个独立 plan |
| OOS-3 | Daemon 模式（本地后台进程跑任务） | Desktop 主进程已是「本地后台」；远程 Backend 另有 plan |
| OOS-4 | PostgreSQL 任务队列 | SQLite 满足 + 部署简单 |
| OOS-5 | Multica Autopilot 全套（cron / webhook / api 触发） | AgenticX `automation:*` 已覆盖周期触发 |
| OOS-6 | Stampede control（多 daemon 协调） | 单进程不需要 |
| OOS-7 | Skill marketplace 自营 | 已有 ClawHub 集成 |
| OOS-8 | Workforce / Workforce 与 SubagentTaskStore 双轨改造 | 待 Workforce 团队评估后另起 plan（F3）|
| OOS-9 | 与 ClawTeam 重叠的 git worktree / 任务 DAG / 计划审批 / TOML 团队模板 / 费用追踪 | ClawTeam plan 已覆盖，本 plan 不重复（在 §6 与 ClawTeam 互补章节中协调）|
| OOS-10 | Compactor 改造 / 用户意图锚定 | 已有 `2026-05-11-long-horizon-goal-anchor.plan.md` |
| OOS-11 | Tool call UX 收敛 / actionable nudge | 已有 `2026-05-08-toolcall-ux-and-longrun-stability.plan.md`（FR-8/9）|
| OOS-12 | LLM context 自治压缩 | 不动 `compactor.py` |

---

## 9. 启动条件 / 前置依赖

- ✅ Multica 研究产物 5 份已落盘到 `research/codedeepresearch/multica/`
- ✅ Gap 分析与 ClawTeam 互补章节已完成
- ✅ Proposal 8 段结构已落盘
- ⚠️ Phase 1 启动前需 Damon Review 本 plan（特别是 §3 FR 范围与 §8 OOS 边界）
- ⚠️ Phase 2 启动前需确认 `agent_runtime.py::run_turn` 添加 `on_session_assigned` 可选回调对其他模块（如 `learning/session_review_hook.py`、`hooks/`）无副作用

---

## 10. 提交策略

按 plan-management.mdc 规则：
- 每个 Phase 一次或多次 `/commit --spec=.cursor/plans/2026-05-12-multica-internalization.plan.md`
- 每条 commit 必须含 `Plan-Id: 2026-05-12-multica-internalization` + `Plan-File: .cursor/plans/2026-05-12-multica-internalization.plan.md` + `Made-with: Damon Li`
- 完成 Phase 3 后：`/update-conclusion --plan=.cursor/plans/2026-05-12-multica-internalization.plan.md`
- 本 plan 文件本身在 Phase 1 第一次 commit 时一并入库
