# Plan: AgenticX 运行时不变量内化 03 —— 委派唤醒（跨重启可恢复）

Planned-with: GLM-5.4（Trae）
Suggested-Impl-Model: GLM-5.4
Status: implemented
Plan-Id: 2026-11-27-runtime-invariants-03-dispatch-mailbox
Parent-Plan: `.cursor/plans/pending/2026-11-27-runtime-invariants-master.plan.md`

> 规划阶段的限制：当前环境不允许执行工作区内的任何脚本与命令。本文件的全部事实来自**阅读核实**（给出 `文件:行号`，行号以当前工作树 `5731113e` 为准），没有任何一条来自执行输出。所有「预期」「基线数字」都是待实施时执行后补测的，见 `## Verification`。

## Goal

让 master plan 的闭环判据成立：**worker 等待中、后端重启后，一封邮件把它唤醒，上下文续得上，且只执行一次。**

内核只提供三件原语，不做编排器：

1. 跨重启的上下文重建（worker 的运行上下文落盘，重启后可还原成能继续跑的会话）。
2. 显式的挂起态（一个持久、可查询的状态说明「这个 worker 在等邮件、可以被唤醒」）。
3. 幂等的持久邮件（同一封邮件无论投递多少次，至多执行一次）。

外加一条接线：唤醒回合的结构事件走子 plan 01 的 Replay Ledger，且不破坏 01 的任何不变量。

闭环判据拆成验收条件：

- **AC-1（显式挂起态持久）**：worker 的回合自然结束后，run 记录上的 dispatch 状态为 `waiting`；该状态与上下文快照都在本地盘上，进程重启后仍可读。
- **AC-2（重启后找得回）**：用同一 `owner_session_id` 新建的 `AgentTeamManager`（内存为空）收到邮件时，能按 `agent_id` / `dispatch_id` / 名称找到 worker，不再返回 `not_found`。
- **AC-3（上下文续得上）**：唤醒回合的模型输入里含有上一回合的内容；唤醒结束后新的上下文快照在旧快照的基础上增长（旧回合的回复仍在、新邮件作为 user 行进入上下文）。
- **AC-4（只执行一次）**：同一 `message_id` 投递两次（同进程重复、再重启后重复）只执行一次，第二次返回 `duplicate: true` 且不调用模型；不同 `message_id` 各执行一次。
- **AC-5（唤醒事件走账本）**：唤醒回合在 Replay Ledger 里有一个 `agent_id` = worker id 的 run；owner 会话的 `find_open_run` / `list_runs` 结果不包含它，父回合的恢复锚点与重连回放不受影响。
- **AC-6（旧行为不回归）**：开关关闭后，记录形状、`not_found` 行为、进程内唤醒行为与 03 之前逐字一致；01、02 的全部测试保持通过；`spawn_subagent` 的参数与返回形状不变。

## 核实结论

### 0. 阅读范围与方法

只读代码，不执行。引用的行号均已在当前工作树逐条复核。用到的既有 API（签名、参数名、字段、枚举值）都在本文件 Tasks 的「依赖的现有 API」表里给出出处；没有亲自读到的 API 一律不进入代码块，而是列入 `### 未经执行验证的假设清单`。

### 1. HA 模式下唤醒以哪一份为准

**结论：03 采用单机口径。run 记录、邮件、worker 上下文、唤醒账本全部在本地盘的同一个会话目录下，以这份本地盘为准；HA 换副本后新副本读不到，唤醒必须明确拒绝（`not_found`），不得静默接受。不做共享邮件队列。**

证据：

- run 记录：`SubAgentRunStore` 的根目录是 `Path.home() / ".agenticx" / "sessions" / <owner_session_id> / "subagent_runs"`（`agenticx/runtime/subagent_runs/store.py:48-66`）。`store.py:36-39` 的 `TODO(HA)` 写明：即使会话存储后端是 redis，run 记录仍留在本地盘。
- 01 的恢复分层：HA 模式下 `load_resume_anchor` 不读账本，改读检查点（`agenticx/runtime/checkpoint.py:172` 的 `if _redis_ha_mode() or not resume_from_ledger_enabled()`，`_redis_ha_mode` 在 `:149`）；单机才是账本优先（`:175-179` 调 `project_resume_anchor`）。账本目录本身也在本地盘（`agenticx/runtime/replay_ledger/store.py:77-80` 的 `<sessions_root>/<session_id>/runs/<run_id>`）。
- `SessionStorageBackend`（`agenticx/studio/storage/backend.py:31-66`）只有按会话的 messages / agent_state / automation_tasks / mcp_state，没有通用 KV，放不下邮件队列。
- master plan『已冻结决定』禁止新增 Redis append API。

对设计的影响：

| 数据 | 放哪 | 换副本后能否读到 | 口径 |
| --- | --- | --- | --- |
| run 记录（含 dispatch 记录） | `<owner>/subagent_runs/<run>.json` 的 `detail_refs["dispatch"]` | 否 | 本地盘为准 |
| 邮件（投递/消费日志） | `<owner>/subagent_runs/<run>.mailbox.json` | 否 | 本地盘为准 |
| worker 上下文快照 | `<owner>/subagent_runs/<run>.context.json` | 否 | 本地盘为准 |
| 唤醒回合的账本 | `<sessions_root>/<owner>:dispatch:<agent_id>/runs/<run_id>/` | 否 | 本地盘为准，与 01 同层 |

HA 下的行为：新副本的 `send_message_to_subagent` 内存与磁盘都找不到该 worker，返回 `{"ok": False, "error": "not_found"}`，发送方得到明确失败。**接受即已持久化，否则明确拒绝**——这是 03 的唯一承诺。同一台机器上两个后端进程共用同一个 `HOME` 的场景不在承诺范围内（现有 `SubAgentRunStore` 的锁是进程内 `threading.RLock`，`store.py:45-46`、`:61-66`）。

### 2. 现有 automation 会不会与唤醒重复触发

**结论：没有任何一个现有调度面会重放邮件、或自行拉起同一个 worker。重复的唯一来源是父回合自己被恢复后，模型重新发起一次新的 `send_message_to_agent`——那是新工具调用、新邮件，不属于幂等键能去重的范围。**

逐个调度面：

| 调度面 | 重启后的行为 | 证据 | 会不会重复触发唤醒 |
| --- | --- | --- | --- |
| `agenticx/studio/automation_scheduler.py` | `tick` 只在 leader 上跑；按分钟去重（`lastRunAt.startswith(minute_key)` 则跳过）；每次触发新建会话并 `POST /api/chat`；R6 把崩溃进程遗留的 `runningSince` 标为 interrupted | `tick` `:164-203`，去重 `:172-175`、`:194`；建会话 `:258`；发消息 `:299`；`_mark_interrupted_tasks` `:333-334` | 不会。它从不寻址既有 dispatch；即便模型在新会话里再 spawn，也是新的 `agent_id` / `dispatch_id` |
| `resume_interrupted_sessions` | 只重入**父回合**；不复活子智能体 | `agenticx/studio/session_manager.py:1159-1207`；`:1230-1231` 注释与调用「Subagent runs of the crashed turn are not resurrected; mark them」 | 不会直接重复。重入的父模型可能再发一封新邮件（见上） |
| `_mark_subagent_runs_interrupted` | 意图把 `running` 的 run 记录改成 `interrupted` | `session_manager.py:1274-1287` | **实际是空操作**，见第 10 节 F-1 |
| `agenticx/runtime/durable_jobs/` | 只认领 `QUEUED` / `SCHEDULED`，以及租约过期的 `RUNNING`；`WAITING_EXTERNAL` 只有定义、没有任何使用点 | `models.py:26`（`CLAIMABLE_STATUSES`）、`models.py:19`；`store.py:159-173`、`:179-220` | 不会。该包不引用 team manager / subagent，job 是 Studio 自动化经 HTTP 触发 |
| `agenticx/longrun/orchestrator.py` | `_entries` 只在内存（`:74`）；重启后 `_tick` 会对仍然 pending 的任务重新 `_dispatch` → `submit_for_longrun` → `spawn_subagent`，得到**新的** `agent_id` | `:120-137`、`:205`；`agenticx/longrun/studio_routes.py:101` | 不涉及邮件（longrun 从不调用 `send_message_to_subagent`）。但存在**重启后对同一 longrun 任务重复 spawn** 的既有风险，与 03 无关，见第 10 节 F-3 |
| `agenticx/runtime/automation_run_health.py`、`agenticx/runtime/_automation_tasks_io.py` | 前者只做运行健康标记（`mark_run_started` / `mark_interrupted_on_startup`），后者只是任务的读写 | 阅读核实 | 不会 |

对设计的影响：`dispatch_id` 作为**寻址键**（指明唤醒哪个委派单元），`message_id` 作为**幂等键**（指明是哪一封邮件）。master plan 风险条写的「`dispatch_id` 作幂等键」在实现上落为「同一 dispatch 下同一 `message_id` 至多消费一次」。模型重发新邮件无法、也不应该被内核去重。

### 3. 「唤醒事件走账本」具体怎么落

**结论：给被邮件唤醒的那个回合的 worker `AgentRuntime` 传 `run_recorder`，把唤醒回合记成一个独立的账本 run，`agent_id` = worker id，`session_id` 用独立命名空间 `<owner_session_id>:dispatch:<agent_id>`。不改账本数据模型，不改 01 的任何读取方。**

先说为什么必须是一个独立的 run，而不是往父 run 里追加事件：

- 父 recorder 不记录子智能体事件：`ReplayLedgerRecorder._EVENT_MAP` 没有 `subagent_*` 类型；01 的 `tests/test_replay_ledger_recorder.py:385` `test_subagent_runtime_events_do_not_consume_parent_ledger_sequence` 固化了这一点。
- 现有 `EVENT_TYPES`（`agenticx/runtime/replay_ledger/contracts.py:22-51`）有 `subagent_started/progress/checkpoint/completed/error`，但没有「唤醒」类型；新增类型属于数据模型变更，不在本 plan 自行决定的范围内。

所以「唤醒事件走账本」= 唤醒回合是一个用 `run_recorder` 记录的真实 runtime 回合（`run_started` → `user_message`（邮件正文）→ 工具调用 → `run_completed`），可审计、可回放，且不新增事件类型。

**只记唤醒回合，不记 spawn 回合。** `spawn_subagent` 起的第一个回合、`_auto_escalate` 的重试回合保持不记（与 03 之前一致）。理由是代价：`ReplayLedgerRecorder.start_turn` 每回合调用 `_capture_initial_workspace`（`recorder.py:178-179`、`:204-218`）→ `capture_git_workspace_snapshot`（`agenticx/runtime/replay_ledger/workspace_snapshot.py:138-222`）。非 isolate 工作区在 `:147-149` 就以 `not_git_isolate` 短路，代价可忽略；但 isolate 工作区会跑多次 git 子进程（`:159`、`:163`、`:189`、`:196-198`），并在**用户的仓库里**写一个快照 ref（`:201-206`）。如果每个 worker 的每个回合都记，默认每个 spawn 都多付一次这笔代价，还可能在用户仓库里留下 ref。只记唤醒回合，代价只在真正发生唤醒时出现，且与一个父回合同一量级。

**`list_runs` / 未关闭 run 的消费方逐个评估**（记到 owner 会话账本下时的受影响情况）：

| 消费方 | 读什么 | 记到 owner 会话下会怎样 | 命名空间方案 |
| --- | --- | --- | --- |
| `find_open_run`（`agenticx/runtime/replay_ledger/resume_anchor.py:41-52`） | `store.list_runs(session_id)`，取最新一条，`status == "running"` 才返回 | worker 唤醒回合比父回合新；若进程在唤醒回合中途崩溃，worker run 留在 `running`，**盖住父回合的恢复锚点**（`project_resume_anchor` `:83-87` 把它投影成会话的锚点） | 不受影响：`list_runs(owner)` 只扫 `<owner>/runs/*/run.json`（`store.py:375-388`），扫不到 `<owner>:dispatch:<agent_id>/` |
| `read_reattach_replay`（`agenticx/runtime/replay_ledger/reattach.py:122`，调用 `find_open_run` 在 `:137`） | 同上 | 同上：重连端点的回放会回放 worker 的事件 | 不受影响 |
| `/api/runs?session_id=`（`agenticx/studio/run_replay_routes.py:103-124`） | `_store().list_runs(session_id)`，整表返回客户端 | 会话的 run 列表里混入 worker 回合，客户端行为改变（本 plan 不允许改客户端） | 不受影响 |
| `/api/runs/{run_id}` 等（`run_replay_routes.py:126` 起） | 按 `run_id` 经 `_find_run_dir`（`store.py:82-92`，glob `*/runs/<run_id>/run.json`） | — | **仍可按 run_id 访问**（命名空间目录在根下第一层），导出/分支可用 |
| `delete_session_runs`（`store.py:588` 起）+ `delete_snapshot_refs`（`workspace_snapshot.py:248-276`） | 按 `session_id` 删 `<sid>/runs` 子树与快照 ref | 随会话删除一并清理 | **不会**随 owner 会话删除 → 必须补一处清理（见 D-7） |
| `ReplayLedgerRecorder.finish` → `enqueue_completed_run`（`recorder.py:579-598`，调用在 `:593`） | 企业 Trace | worker 唤醒回合会作为独立 trace 上传；若租户允许 `trace_content`，邮件正文会作为 `user_text` 上传 | 同左。处置见 D-6b（需主会话定案） |
| `agenticx/studio/server.py` 的两处 `recorder_for_session`（`:4786-4789`、`:5835-5838`） | `agent_id=str(getattr(managed, "avatar_id", "") or "meta")` | 父 run 的 `agent_id` 恒为 avatar 或 `meta` | 不涉及 |
| `agenticx/runtime/enterprise_trace.py` | 读 run 与 events 生成 span | 同上 | 同上 |

**备选方案与比较：**

| 方案 | 做法 | 优点 | 代价 |
| --- | --- | --- | --- |
| **甲（推荐）：独立 `session_id` 命名空间** | `session_id = f"{owner}:dispatch:{agent_id}"`，同一个 `sessions_root` | 01 的读取方零改动、按构造隔离；按 run_id 仍可访问；清理可复用 `delete_session_runs` | 会话删除时要显式清理命名空间目录（`session_manager.py` 加 6 行）；`validate_ledger_id` 要求 id 匹配 `^[A-Za-z0-9._:-]{1,128}$`（`contracts.py:18`），需在构造 recorder 前校验 |
| 乙：记到 owner 会话 + 按 `agent_id` 过滤 | 改 `find_open_run` 增加 actor 过滤，并沿 `project_resume_anchor` → `load_resume_anchor` → `resume_interrupted_sessions`、`read_reattach_replay` → `server.py:5628` 一路传 avatar id | worker 回合与会话同一账本目录 | 改 01 的 4 个文件加 `server.py` 的调用点；`/api/runs` 仍会多出 worker 回合；触碰 01 刚落地的不变量 |
| 丙：不记回合，只追加一个标记事件 | 手工 `open_run` + `append_event` 一个 `subagent_*` 事件 | 最省 | 不可回放；`user_message` 之外的类型语义不对；等于绕过 recorder |
| 丁：把 worker 账本放到 `<owner>/subagent_runs/<agent_id>/` 下（换 `sessions_root`） | 与 run 记录同目录 | 目录最整齐 | 主 store 的 `_find_run_dir` 深度不够，按 run_id 永远找不到，回放/导出不可用；快照 ref 的注册表也在该目录下，清理要另写 |

选甲：它是唯一一个「01 零改动 + 可按 run_id 访问 + 清理复用既有 API」的组合。

### 4. 上下文跨重启重建

**结论：现有 `RunRecord` 只有身份信息，没有对话上下文。需要新增一个每 worker 一份的上下文快照文件，在回合结束时（进入挂起态的同一时刻）写；重启后由 run 记录 + 快照还原 `SubAgentContext`，再走现有的 `_rebuild_agent_session` / `_seed_session_history`。**

`SubAgentContext` 各字段的来源（`agenticx/runtime/team_manager.py:116-157`）：

| 字段 | 现在在哪 | 重启后从哪还原 |
| --- | --- | --- |
| `agent_id`、`name`、`role`、`task`、`source_tool_call_id`、`provider_name`、`model_name`、`avatar_id`、`persona_prompt`、`cluster_id`、`badge_seq`、`output_files`、`result_file`、`result_summary`、`error_text`、`created_at`、`updated_at` | `RunRecord`（`agenticx/runtime/subagent_runs/contracts.py:78-108`） | `RunRecord` |
| `parent_agent_id`、`depth`、`mode`、`cleanup`、`run_timeout_seconds`、`inherit_parent_context`、`spawn_tree_path`、`workspace_dir` | 只在内存（spawn 时赋值，`team_manager.py:563-589`；`_run_store_open` `:1196-1219` 不落盘） | **新增**：dispatch 记录（run 记录的 `detail_refs["dispatch"]`） |
| `agent_messages`、`artifacts`、`context_files`、`attachments`、`allowed_tool_names`、`final_text`、`failure_count`、`escalation_level`、`pause_detector`、`pause_retryable` | 只在内存；`_archive_context` 还会把前四个清空（`:1172-1181`） | **新增**：上下文快照 `<run>.context.json` |
| `status` | `RunRecord.status` | `RunRecord.status`（`running`/`pending` 视为重启打断，映射为 `PAUSED`，见第 8 节） |
| `confirm_gate`、`clarify_gate` | 内存 | 新建（`self.confirm_gate_factory(agent_id)`）；挂起中的确认/澄清请求重启后丢失，不在 03 范围 |
| `recent_events` | 内存 | 置空 |

**快照什么时候写**：在 `_run_subagent` 的 `finally` 里、`_run_store_close` 之前（`team_manager.py:1559` 之前）。此时 `context.agent_messages` 已经是 `list(session.agent_messages)`（`:1479`），状态已经定型（含 `:1488-1542` 的降级判断），且 `_auto_escalate` 的分支（`:1555-1558`）已经走完——被升级重试的回合会在它自己的 `finally` 里写。只在进入 `waiting` 时写；进入 `closed`（取消 / `cleanup == "delete"`）不写。

不在回合中途写（不接 `AgentRuntime` 的 `mid_turn_persist`）：每轮写一份与上下文等大的 JSON 代价高，而闭环判据要求的是「等待中」的 worker，它的回合已经结束、快照已经落盘。回合中途崩溃的窗口见第 6 节。

**体积风险**：`agent_messages` 可能很大（工具结果）。父会话本来就每回合持久化自己的 `agent_messages`；worker 是新增的一份，每个 worker 恰好一份、原子覆盖。`artifacts` / `context_files` / `attachments` 是内容本身，也可能大。03 不设上限（ Runtime 自己会做上下文压缩），列入风险。

**重启后怎么还原成能继续跑的会话**：与进程内的「非 RUNNING → 唤醒」路径完全相同——`send_message_to_subagent` 调 `_ensure_agent_session(context)`（`:716`、`:750-755`）→ `_rebuild_agent_session`（`:757-769`：`_build_isolated_session(workspace_dir=context.workspace_dir)`、回填 `context_files` / `artifacts`、`_seed_session_history` 把 `context.agent_messages` 装进新会话 `:772-781`、把 `attachments` 放回 scratchpad）→ `_run_subagent(..., resume_input=邮件正文)`（`:1271-1280` 再做一次同样的装配，`_seed_session_history` 在 `:1279`）。`AgentRuntime.run_turn` 把 `resume_input` 作为 user 行同时追加进模型输入和 `session.agent_messages`（`agenticx/runtime/agent_runtime.py:4563-4573`），所以邮件自然成为上下文的一部分。`workspace_dir` 为空时回落到 `base_session.workspace_dir`（`_build_isolated_session` 的默认值，`:312`）。

### 5. 「等待中」的语义与显式挂起态

**结论：挂起态是 dispatch 记录上的一个显式状态字段 `state ∈ {running, waiting, closed}`，持久在 run 记录的 `detail_refs["dispatch"]["state"]`。worker 在回合自然结束时进入 `waiting`；邮件把它移出（回到 `running`）；取消把它置为 `closed`。`SubAgentStatus` 不新增枚举值。**

- 现状：`SubAgentStatus`（`team_manager.py:85-91`）只有 `PENDING / RUNNING / PAUSED / COMPLETED / FAILED / CANCELLED`。`PAUSED` 是轮次上限暂停（`:1445-1447` `paused_at_limit`），不是等邮件。
- 「结束回合即挂起」：master plan 的内化清单写的就是这一点。进程内 `COMPLETED` 的 worker 本来就可以被邮件唤醒（`:714-727` 的非 RUNNING 分支），所以「自然结束」在语义上就是「挂起、可唤醒」。`FAILED` 与 `PAUSED` 在进程内同样可被唤醒，保持一致。
- 为什么不新增 `SubAgentStatus.WAITING` 并用它替代回合结束时的 `COMPLETED`：
  - `store.py:177` 终态集合 `{"completed", "failed", "cancelled", "paused"}` 决定是否写 `completed_at`；`store.py:341-349` cluster 封口用同一类终态集合；`resolver.py:20` 的 `_TERMINAL_STATUSES` 决定 `apply_live_overrides` 是否提前返回、`resolver.py:14-19` 的 `_ACTIVE_STATUSES` 决定纯内存行是否并入列表。新增状态值要在每一处归类。
  - cluster 封口、`_build_result_summary` 的文案、`summary_sink`、以及一批现有测试断言的 `status == "completed"` 都会变。
  - 挂起与 run 的生命周期是正交的：一个 worker 同时是 `completed`（回合跑完了）和 `waiting`（可以再被邮件叫醒）。把它做成 `status` 会把两件事混在一起。
- 挂起态对读取方可见：`resolver._merge_ledger_row` 直接 `record.to_dict()`（`resolver.py:164-174`），所以 `list_resolved_runs` / `resolve_run` 的行里自然带上 `detail_refs.dispatch`，`resolver.py` 不需要改。进程内的 `query_subagent_status` 行通过 `_serialize_status` 增加 `dispatch_id` 字段暴露寻址用的 id。
- 谁把它移出：只有 `send_message_to_subagent` 的唤醒分支（置 `running`）。`retry_subagent` 与 `_auto_escalate` 不改变 dispatch 状态（它们的回合结束时照常回到 `waiting`）。

### 6. 幂等

**结论：`dispatch_id` 是寻址键（一个委派单元，与 spawn 出的 worker 1:1）；`message_id` 是幂等键（一封邮件）。语义是「先持久化认领、后执行」的至多一次（at-most-once）。重复投递返回 `{"ok": True, "duplicate": True, ...}`，不执行。**

- `dispatch_id`：`"dsp-" + uuid4().hex[:12]`，在 `spawn_subagent` 体内铸造（不改它的参数与返回形状），存在 run 记录的 `detail_refs["dispatch"]`：
  ```
  dispatch = {
      dispatch_id, task_id (= worker 的 agent_id), parent_agent_id, parent_tool_call_id (= spawn 的 source_tool_call_id),
      work_unit (= spawn 时的 task 文本), depth, mode, cleanup, run_timeout_seconds,
      inherit_parent_context, spawn_tree_path, workspace_dir, state
  }
  ```
  `task_id` 就是 worker 的 run id：一次 spawn 就是一个任务。`retry_subagent` / 升级重试留在同一个 dispatch 内，不另铸 id。
- `message_id` 的来源，按优先级：(1) 调用方显式给的 `message_id`；(2) meta 工具调用注入的 `__tool_call_id`（`agenticx/runtime/agent_runtime.py:3444` 把它并进 `dispatch_arguments`；`meta_tools.py:2869` 已在 spawn 上用它作 `source_tool_call_id`），格式 `call:<tool_call_id>`；(3) 都没有（HTTP 路径 `server.py:4310`）则随机生成，即不去重。同一次工具调用被重放时天然去重；模型新发起的一次调用是新邮件。
- 为什么不用「dispatch_id + 正文哈希」做幂等键：协调者对同一个 worker 合法地发两次「继续」会被误判为重复。
- 认领的原子性：`claim_mail` 在 `SubAgentRunStore` 的按根目录共享的 `threading.RLock`（`store.py:45-46`、`:61-66`）内完成「读邮箱 → 查重 → 追加 → 原子写」。异步函数里这段没有 `await`，对事件循环是原子的；对不同线程由 RLock 保证。跨进程不保证（见第 1 节）。
- 写失败时的策略是 fail-closed：认领写不进去就返回 `mailbox_unavailable`，不执行。宁可少执行，不肯多执行。

**崩溃窗口（不含糊地写明）：**

| 崩溃时刻 | 结果 |
| --- | --- |
| 认领已落盘、回合尚未开始（`create_task` 之前或任务尚未被调度） | 邮件已是 `consumed`，**不会执行**；同一 `message_id` 再投递被去重。这是**可能丢弃**的窗口。发送方需要换一个新的 `message_id` 重发。 |
| 回合执行中途 | 同上：邮件 `consumed`，回合丢失；上下文快照停留在上一回合结束时的状态。再次唤醒会以上一回合的上下文继续。**可能丢弃**该回合已做的工作。 |
| 认领写盘之前崩溃 | 邮件从未被接受，重发会正常执行。 |

也就是说 03 保证的是「**至多一次**」，不是「恰好一次」。「恰好一次」需要回合级的检查点与重入，那是另一个课题（父回合有 01 的恢复，worker 回合没有）。选至多一次是因为闭环判据的硬要求是「只执行一次」。

**邮件什么时候写**：任何被接受的邮件（RUNNING 时追加到活动会话的也算）都立刻以 `consumed` 写入邮箱。RUNNING 情况下 `consumed_by = "running_turn"`，唤醒情况下 `"wake_turn"`。邮箱里没有 `pending` 状态的邮件——没有延迟投递、没有重试、没有定时器，邮件到达即交给 worker。

### 7. 哪些状态下的 worker 可被唤醒

**重启后按本地盘上的 dispatch 状态判定：**

| run 记录 `status` | dispatch `state` | 可否唤醒 | 理由 |
| --- | --- | --- | --- |
| `completed` | `waiting` | 可以 | 回合自然结束即挂起；与进程内「非 RUNNING 一律唤醒」一致 |
| `paused` | `waiting` | 可以 | 轮次上限暂停，带历史继续；同上 |
| `failed` | `waiting` | 可以 | 进程内现状即可被邮件唤醒（`:714-727`）；`failure_count` / `escalation_level` 从快照还原，升级预算不重置 |
| `running` / `pending` / `interrupted` | `running`（陈旧） | 仅当存在上下文快照时可以 | 本进程里没有活动任务却仍是 `running`，只可能是被重启打断；按 `PAUSED` 对待。没有快照（首个回合就崩了）则拒绝 |
| `cancelled` | `closed` | 不可以（`dispatch_closed`） | 取消是显式决定，委派单元已关闭 |
| `cleanup == "delete"` 的 worker 回合结束后 | `closed` | 不可以 | 进程内它本来就从 `_agents` 移除（`:1553-1554`），不可寻址 |
| 没有 dispatch 记录（03 之前产生的 run 记录） | — | 不可以（`dispatch_not_registered`） | 没有持久过上下文，唤醒等于让 worker 失忆重做 |
| 有 dispatch 但没有上下文快照 | — | 不可以（`context_unavailable`） | 同上，且避免重复副作用 |

**进程内行为不变**：`_agents` / `_archived_agents` / 别名里找得到的，仍按 `team_manager.py:679-748` 现有逻辑处理，不看 dispatch 状态。由此带来一处已知的不对称：进程内一个被取消的 worker 仍可被邮件复活（现有行为，`finally` 的 `self._cancelled.discard` `:1551` 之后），重启后则不可以。见「需主会话定案」D-5b。

### 8. 崩溃时正在运行的 worker 与挂起态

**结论：run 记录为 `running` 的崩溃 worker 不是「挂起」，是「被打断」。它的 dispatch 状态停在 `running`，没有进入过 `waiting`。对它投递邮件时按第 7 节的规则处理。**

- 现有的 `_mark_subagent_runs_interrupted`（`session_manager.py:1274-1287`）意图在恢复扫描时把这些记录改成 `interrupted`，但它实际上什么也没做（第 10 节 F-1）。
- 03 不修这个函数（它不在闭环判据的路径上，修了会让一批记录的状态从 `running` 变成 `interrupted`，而 `interrupted` 不是 `SubAgentStatus` 的值、也不在 `resolver.py:14-20` 的两个集合里，客户端如何呈现未经核实）。处置见「需主会话定案」D-8。
- 03 的唤醒路径不依赖记录是 `interrupted` 还是 `running`：只要本进程内存里没有这个 worker，磁盘上的 `running` 就按陈旧处理。
- worker 崩溃前如果至少完成过一个回合，上一回合结束时写过快照，邮件可以以上下文继续；否则拒绝。

### 9. `agenticx/collaboration/` 与主链的关系

**结论：无关，03 不碰它。**

- 全仓引用它的只有两处：`agenticx/runtime/group_router.py`（`:3191`、`:3241-3245`）与 `agenticx/studio/server.py`（`:8166` `WorkforceEventBus`、`:8188` `WorkforceAction`、`:8344` `task_lock`），都是群聊 / workforce 事件总线路径。
- 反向：`agenticx/collaboration/` 下没有任何对 `team_manager`、`AgentTeamManager`、`subagent_runs`、`spawn_subagent`、`send_message_to` 的引用（grep 零命中）。
- `team_manager.py` 与 `meta_tools.py` 都不 import 它。邮件唤醒的入口是 `meta_tools.dispatch_meta_tool_async` 的 `send_message_to_agent` 分支（`meta_tools.py:2898-2909`）与 HTTP 路径（`server.py:4310`），两条都落在 `team_manager.send_message_to_subagent`。

### 10. 与 master plan 假设不同、或需主会话知晓的事实

- **F-1（缺陷）`_mark_subagent_runs_interrupted` 是空操作。** `session_manager.py:1283` 写的是 `run_store.update_status(record.run_id, "interrupted")`，而 `update_status` 的 `status` 是仅关键字参数（`store.py:148-156`，`run_id` 之后有 `*`）。这个调用会抛 `TypeError`，被 `:1284-1285` 的 `except Exception: pass` 吞掉。tests 目录里没有任何测试引用这个函数。所以主会话事实 (g)「恢复扫描时把状态为 running 的 run 记录改成 interrupted」描述的是意图，不是现状。
- **F-2 进程内被取消的 worker 可以被邮件复活。** 取消完成后 `finally` 会 `self._cancelled.discard(context.agent_id)`（`team_manager.py:1551`），之后 `send_message_to_subagent` 的非 RUNNING 分支照常起新回合。没有测试覆盖。
- **F-3 longrun 在重启后可能对同一任务重复 spawn。** `orchestrator.py:74` 的 `_entries` 只在内存，`:120-137` 的 `_tick` 对源里仍 pending 的任务重新 `_dispatch`。与邮件无关，是既有风险，不在 03 范围。
- **F-4 `SubAgentContext` 的 `agent_messages` 在归档时被清空**（`team_manager.py:1177`），但 `self._agents[agent_id]` 仍指向完整上下文（只有 `cleanup == "delete"` 会移除，`:1553-1554`）。进程内唤醒靠的是 `_agents` 里的完整上下文，不是归档快照。
- **F-5 唤醒回合若记入账本，`ReplayLedgerRecorder.finish` 会 `enqueue_completed_run`。** `agenticx/runtime/enterprise_trace.py` 模块 docstring（`:9-10`）承诺「subagent task text 永不进入 outbox」。租户允许 `trace_content` 时，发给 worker 的邮件正文会作为 `user_text` 上传。见 D-6b。
- **F-6 `resolver.py` 不需要改。** master plan 的落点表把它列为 Modify；核实后 03 所需的 dispatch 信息经 `record.to_dict()` 已在行里。
- **F-7 `capture_git_workspace_snapshot` 只对 isolate 工作区产生 git 子进程与 ref。** `workspace_snapshot.py:147-149`：`load_isolate_state(session)` 为空即返回 `not_git_isolate`。

## Root cause

闭环判据今天不成立，是四个各自独立的缺口叠加：

1. **寻址只在内存。** `send_message_to_subagent` 只查 `_agents`、`_archived_agents` 和名称 / avatar 别名（`team_manager.py:681-695`），都找不到就 `not_found`（`:696-702`）。这三个字典只在进程内（`:191-198`），重启即丢。
2. **上下文只在内存。** `SubAgentContext` 的全部字段都在内存（`:115-157`）；`SubAgentRunStore` 持久化的只有 run 记录与活动时间线，`RunRecord` 没有任何对话字段（`contracts.py:78-108`）。重启后即使找得到 worker，也没有东西可以续。
3. **没有显式的等待态。** 「可以再被叫醒」这件事只隐含在「进程内 `COMPLETED` 的 worker 还在 `_agents` 里」这个事实中，磁盘上没有任何记录表达它。
4. **没有持久的邮件记录。** `send_message_to_subagent(agent_id, message)` 没有 `message_id`，同一封邮件投两次就执行两次；重启后也无法判断某封邮件是否已经执行过。

外加一条：worker 的回合不进任何账本——`team_manager.py:1290-1298` 构造 `AgentRuntime` 时没有传 `run_recorder`，全仓只有三处传它（`agenticx/studio/session_manager.py:1321`、`agenticx/studio/server.py:4804`、`:5852`）。

## Design

每个决定写清选了什么、备选是什么、为什么。

### D-1 开关：一个布尔，默认开

- 选了：`AGX_DISPATCH_MAILBOX` / `runtime.dispatch_mailbox`，默认 `True`，经 `agenticx/runtime/harden_flags.py` 的 `_resolve_bool` 解析（`:57-64`）。关闭后：不铸 `dispatch_id`、run 记录的 `detail_refs` 与 03 之前逐字一致、不写邮箱与快照、找不到就 `not_found`、唤醒回合不记账本。
- 备选：默认关。否决：闭环判据是 master plan 要「内化」的不变量，默认关等于没有内化。
- 为什么是一个开关而不是三个：三件原语只对同一个闭环有意义，拆开只会出现「有邮箱没快照」这类半开状态。

### D-2 dispatch 记录放在 run 记录的 `detail_refs["dispatch"]`

- 选了：不改 `RunRecord` 的字段，用现成的 `detail_refs`（`contracts.py:105`，`Dict[str, Any]`）。
- 备选：给 `RunRecord` 加 `dispatch_id` 等字段。否决：那是 run 记录的 schema 变更，`to_dict()` 输出、`from_dict` 兼容都要处理；`detail_refs` 本来就是放这类附加引用的地方（现有 `scratchpad_key`、`result_md_path`）。
- 写入点：`_run_store_open` 的 `open_run(detail_refs=...)`（`team_manager.py:1199-1215`）。`close_run` 与 `merge_detail_refs` 对 `detail_refs` 是按键合并且跳过 `None`（`store.py:185-206`），所以后续状态更新用 `merge_detail_refs(run_id, {"dispatch": <完整 dict>})` 覆盖整个 `dispatch` 值即可。
- `dispatch_id` 怎么让调用方知道：`_serialize_status` 增加 `dispatch_id`（`team_manager.py:1146-1170`），`query_subagent_status` 与 `list_resolved_runs` 的行里都有。`spawn_subagent` 的返回形状不变。

### D-3 挂起态是 dispatch 记录上的 `state`，不是 `SubAgentStatus`

见核实结论第 5 节。状态机：

```
spawn ──open_run──▶ running
running ──回合自然结束（非取消、非 cleanup=delete）──▶ waiting
running ──取消 / cleanup=delete 的回合结束──▶ closed
waiting ──邮件唤醒──▶ running
waiting ──取消──▶ closed
closed ──（终态，重启后不可唤醒）──
```

### D-4 邮件：先持久化认领，后执行；`message_id` 为幂等键

见核实结论第 6 节。邮箱文件 `<run>.mailbox.json`，只保留最近 50 封（幂等窗口是有界的：更早的邮件被淘汰后再重投会被当作新邮件——这是有意的体积上限，列入风险）。

### D-5 上下文快照：每 worker 一份，回合结束时原子覆盖

见核实结论第 4 节。文件 `<run>.context.json`。

### D-5b 唤醒资格按磁盘状态判定，进程内路径不动

见核实结论第 7 节。

### D-6 唤醒回合走账本：独立命名空间，只记唤醒回合

见核实结论第 3 节。实现：`_run_subagent` 增加仅关键字参数 `wake_mail`；只有邮件唤醒的分支传它；`AgentRuntime(...)` 仅在 `wake_mail is not None` 时多传一个 `run_recorder`。recorder 由 `team_manager` 用 `ReplayLedgerRecorder(store=ReplayLedgerStore(<sessions_root>), session_id="<owner>:dispatch:<agent_id>", agent_id=<agent_id>, provider=..., model=...)` 构造；账本数据模型零变更。

**D-6b（需主会话定案）企业 Trace 是否上传 worker 唤醒回合。** 见「需主会话定案」。

### D-7 会话删除时清理命名空间账本

`SessionManager.delete` 现在只删 owner 会话自己的账本子树（`session_manager.py:1376-1379`）。命名空间目录是 `<sessions_root>` 下的兄弟目录，不会随之删除；isolate 工作区下它还登记着用户仓库里的快照 ref（`workspace_snapshot.py:207-209`）。所以在同一处补一次清理：遍历该会话的 run 记录，对每个带 `dispatch_id` 的 run 调 `ReplayLedgerStore(sessions_root).delete_session_runs("<owner>:dispatch:<agent_id>")`——复用既有 API，不旁路。必须在 `_purge_session_state(sid)`（`:1380`）之前执行，因为清理要读的 run 记录在那个目录里。

### D-8 不修 `_mark_subagent_runs_interrupted`

见核实结论第 8 节与 F-1。

### D-9 存储方法放在 `SubAgentRunStore`，业务逻辑放在新模块

- `store.py` 只增加三个通用方法：`read_aux_json`、`write_aux_json`、`locked`（按根目录的锁的上下文管理器）。文件命名 `<safe_run_id>.<suffix>.json`，用现有的 `_safe_name`（`store.py:608-610`）与 `_write_json`（`:660-683`，mkstemp + fsync + `os.replace`，失败时删临时文件并重新抛出）。
- 新模块 `agenticx/runtime/subagent_runs/dispatch.py` 放全部业务逻辑：铸 id、查 dispatch、状态迁移、认领、快照读写、命名空间 id、会话级清理。它对 Replay Ledger 的 import 全部放在函数体内，模块层不新增 `subagent_runs → replay_ledger` 的依赖边。
- 备选：把逻辑直接写进 `team_manager.py`。否决：那个文件已经 2000 多行；业务逻辑单独成模块才能被单元测试直接覆盖。

### D-10 `meta_tools.py`：`agent_id` 接受 `dsp-*`，新增可选 `message_id`

- `send_message_to_agent` 的 schema（`meta_tools.py:395-413`）`additionalProperties: False`，所以要支持 `message_id` 必须进 schema。`required` 不变。
- 分派（`:2898-2909`）多传一个 `message_id=_mail_message_id(arguments)`。`dlg-` 前缀的委派路径不变。
- HTTP 路径 `server.py:4310` 不改：它不传 `message_id`，走随机 id，重启后的磁盘回落自动生效。

### 仓库对新 Python 文件的惯例（新代码遵守）

- 包内库模块：首行 docstring，末尾一行 `Author: Damon Li`，`from __future__ import annotations`，绝对导入，注释与 docstring 用英文。
- 测试文件：首行 docstring + `Author: Damon Li`；夹具写法沿用 `tests/test_smoke_subagent_run_store.py`：`monkeypatch.setenv("HOME", str(tmp_path))` 隔离 `Path.home()`（`:150`），`AgentTeamManager(llm_factory=lambda: _QuickTextLLM(), base_session=StudioSession(), owner_session_id=...)`，`_wait_until` 轮询（`:141-146`），用真实的 `AgentRuntime` 配假 LLM（`_FakeResponse(content, tool_calls)`，`:31-42`），`asyncio.run(_run())` 驱动。
- 环境变量前缀 `AGX_`，配置键在 `runtime.*` 下，布尔开关经 `harden_flags._resolve_bool` 解析；新开关要有关闭后回到旧行为的测试。
- 新模块与 `replay_ledger` 的依赖只出现在函数体内；不在 `agenticx/runtime/replay_ledger/` 之外出现 `run_dir / "events.jsonl"`、`runs/*/events.jsonl` 字面量；不新增 `save_agent_state(`、`project_resume_anchor(` 调用。

## In scope

- 持久 dispatch 记录（`dispatch_id`、`task_id`、父任务、工作单元、挂起状态）。
- 显式挂起态 `waiting` 及其进入 / 移出 / 关闭。
- worker 上下文快照与跨重启重建。
- 邮件的持久认领与 `message_id` 幂等；`send_message_to_agent` 按 `dsp-*` 寻址、可选 `message_id`。
- 唤醒回合记入 Replay Ledger 的独立命名空间；会话删除时清理。
- 一个开关及其关闭测试。
- 四个新测试文件；`tests/test_subagent_run_resolver.py`、`tests/test_smoke_subagent_run_store.py` 的基线保持通过。

## Out of scope

- DAG 编排器、重试策略、优先级、定时投递、跨会话寻址、跨机放置。
- 改 `spawn_subagent` 的对外参数与返回形状（`team_manager.py:480-499`、`:632-645`）。
- 面向人的 Inbox（它属于 master plan『不做什么』里点名的另一个内化 plan，见 master plan『背景与参考来源』）。
- Desktop / 移动端 UI 与任何客户端代码。
- 共享（跨副本）邮件队列；修改 `SessionStorageBackend`。
- 账本数据模型：`EVENT_TYPES`、dataclass 字段、`SCHEMA_VERSION` 一律不动。
- 修改 `agenticx/runtime/agent_runtime.py`、`agenticx/studio/session_event_hub.py`、`agenticx/runtime/coordination/`、`agenticx/studio/storage/`。
- `agenticx/studio/server.py` 不改（HTTP 路径经 `send_message_to_subagent` 自动获得回落能力）。
- `agenticx/collaboration/`、`agenticx/longrun/`、`agenticx/studio/automation_scheduler.py`、`agenticx/runtime/durable_jobs/`。
- 修 `_mark_subagent_runs_interrupted`（F-1）、longrun 重复 spawn（F-3）、进程内取消后复活（F-2）。
- 记录 worker 的 spawn 回合与升级重试回合；worker 回合的检查点 / 中途持久化；挂起中的确认 / 澄清请求的跨重启恢复。
- 重启后对 worker 的取消（`cancel_subagent` 仍只查内存）。
- 调大 ratchet 基线。

## Precise landing points

| 文件 | 动作 | 位置 | 内容 |
| --- | --- | --- | --- |
| `agenticx/runtime/subagent_runs/dispatch.py` | Create | — | dispatch 记录、邮箱认领、上下文快照、命名空间 id、会话级清理（完整内容见 Task 1） |
| `agenticx/runtime/subagent_runs/store.py` | Modify | `:9-16` imports；`:36-39` TODO(HA) 注释；`:206` 与 `:208` 之间插入 | `contextmanager` / `Iterator` 导入；TODO 补一句；`read_aux_json`、`write_aux_json`、`locked` |
| `agenticx/runtime/harden_flags.py` | Modify | `:144` 与 `:147` 之间插入 | `dispatch_mailbox_enabled()` |
| `agenticx/runtime/team_manager.py` | Modify | `:36-37` imports；`:157` 之后；`:588` 之后；`:658-664`；`:679-748` 整体替换；`:1146-1170`；`:1196-1219`；`:1258` 与 `:1260` 之间插入新方法；`:1260-1266`；`:1290-1298`；`:1559` | 见 Task 2 / Task 3 / Task 4 |
| `agenticx/runtime/meta_tools.py` | Modify | `:2784` 与 `:2785` 之间插入；`:2898-2909`；`:395-413` | `_mail_message_id`；分派传 `message_id`；schema |
| `agenticx/runtime/replay_ledger/recorder.py` | Modify（取决于 D-6b） | `:58-68`、`:75`、`:590-595` | `enterprise_trace` 开关 |
| `agenticx/studio/session_manager.py` | Modify | `:1379` 与 `:1380` 之间插入 | 清理命名空间账本 |
| `agenticx/runtime/subagent_runs/resolver.py` | 不改 | — | F-6 |
| `agenticx/studio/server.py` | 不改 | — | HTTP 路径自动受益 |
| `scripts/ci/ratchet-baseline.json` | Modify | `rules` 数组末尾追加一条 | `dispatch-mailbox-bypass` 规则（见 Task 4 (d)，主会话已定案 D-13） |
| `tests/test_subagent_dispatch_mailbox.py` | Create | — | Task 1 单元测试 |
| `tests/test_subagent_dispatch_lifecycle.py` | Create | — | Task 2 生命周期测试 |
| `tests/test_dispatch_wake_after_restart.py` | Create | — | Task 3 闭环测试 |
| `tests/test_dispatch_wake_ledger.py` | Create | — | Task 4 账本测试 |

## Tasks

四个串行任务，按模块边界拆分：持久原语层 → 生命周期接线 → 唤醒与幂等 → 唤醒事件走账本。每个任务先写失败的测试，再写实现。**实现与本 plan 一致但测试仍失败时，停下报告，不许改断言。** 新文件与被修改的既有大文件都给出完整代码；`team_manager.py`、`meta_tools.py`、`store.py`、`session_manager.py`、`recorder.py` 用「在 `文件:行号` 之间插入 / 把 X 替换为 Y」的精确写法。行号以当前工作树 `5731113e` 为准；同一任务内的行号指未应用本任务之前的状态，应用后以给出的锚点文本定位。

所有测试命令都用 `/opt/miniconda3/bin/python3 -m pytest <文件> -q --no-cov`（`.venv` 没有 pytest）。下列命令在规划阶段**均未执行**。

### Task 1：持久原语层（store 辅助文件、开关、`dispatch.py`）

**目的**：提供三个纯函数级的原语——dispatch 记录读写、邮件认领、上下文快照读写——以及独立命名空间的 id 与会话级清理。不碰 `team_manager.py`。

#### 1.1 先写失败的测试

新建 `tests/test_subagent_dispatch_mailbox.py`（完整内容）：

```python
"""Unit tests for persistent dispatch records, mailbox claims, and context snapshots.

Plan-Id: 2026-11-27-runtime-invariants-03-dispatch-mailbox

Author: Damon Li
"""

from __future__ import annotations

from typing import Any, Dict

import pytest

from agenticx.runtime.harden_flags import dispatch_mailbox_enabled
from agenticx.runtime.replay_ledger.contracts import LEDGER_ID_PATTERN, ReplayRunRecord
from agenticx.runtime.replay_ledger.resume_anchor import find_open_run
from agenticx.runtime.replay_ledger.store import ReplayLedgerStore
from agenticx.runtime.subagent_runs import SubAgentRunStore
from agenticx.runtime.subagent_runs import dispatch as dispatch_store

OWNER = "sess-dispatch-unit"


def _open_spawn(
    store: SubAgentRunStore,
    run_id: str,
    *,
    dispatch_id: str = "",
    name: str = "worker",
    kind: str = "spawn",
) -> None:
    detail_refs: Dict[str, Any] = {}
    if dispatch_id:
        detail_refs[dispatch_store.DISPATCH_DETAIL_KEY] = {
            "dispatch_id": dispatch_id,
            "task_id": run_id,
            "state": dispatch_store.DISPATCH_STATE_RUNNING,
        }
    store.open_run(
        run_id=run_id,
        kind=kind,
        name=name,
        role="worker",
        task="do the work",
        status="running",
        provider="",
        model="",
        persona="",
        avatar_id="",
        source_tool_call_id="",
        started_at=1.0,
        detail_refs=detail_refs,
    )


def _claim(store: SubAgentRunStore, run_id: str, dispatch_id: str, message_id: str, consumed_by: str = "wake_turn"):
    return dispatch_store.claim_mail(
        store,
        run_id,
        dispatch_id=dispatch_id,
        message_id=message_id,
        text=f"mail {message_id}",
        consumed_by=consumed_by,
    )


def test_dispatch_mailbox_switch_defaults_on_and_reads_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("AGX_DISPATCH_MAILBOX", raising=False)
    assert dispatch_mailbox_enabled() is True
    monkeypatch.setenv("AGX_DISPATCH_MAILBOX", "0")
    assert dispatch_mailbox_enabled() is False


def test_new_dispatch_id_is_prefixed_and_unique() -> None:
    first = dispatch_store.new_dispatch_id()
    second = dispatch_store.new_dispatch_id()
    assert first.startswith("dsp-")
    assert len(first) == 16
    assert first != second


def test_claim_mail_consumes_each_message_id_once(tmp_path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("HOME", str(tmp_path))
    store = SubAgentRunStore(OWNER)
    _open_spawn(store, "sa-aaaa1111", dispatch_id="dsp-000000000001")

    accepted, mail = _claim(store, "sa-aaaa1111", "dsp-000000000001", "m-1")
    assert accepted is True
    assert mail["message_id"] == "m-1"
    assert mail["state"] == "consumed"
    assert mail["consumed_by"] == "wake_turn"

    again, existing = _claim(store, "sa-aaaa1111", "dsp-000000000001", "m-1")
    assert again is False
    assert existing == mail

    other, _ = _claim(store, "sa-aaaa1111", "dsp-000000000001", "m-2", consumed_by="running_turn")
    assert other is True

    mails = dispatch_store.read_mailbox(store, "sa-aaaa1111")
    assert [item["message_id"] for item in mails] == ["m-1", "m-2"]
    assert mails[1]["consumed_by"] == "running_turn"


def test_claim_mail_survives_a_new_store_instance(tmp_path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("HOME", str(tmp_path))
    _open_spawn(SubAgentRunStore(OWNER), "sa-aaaa1111", dispatch_id="dsp-1")
    _claim(SubAgentRunStore(OWNER), "sa-aaaa1111", "dsp-1", "m-1")

    accepted, existing = _claim(SubAgentRunStore(OWNER), "sa-aaaa1111", "dsp-1", "m-1")
    assert accepted is False
    assert existing["message_id"] == "m-1"


def test_claim_mail_fails_closed_when_the_mailbox_cannot_be_written(tmp_path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("HOME", str(tmp_path))
    store = SubAgentRunStore(OWNER)
    _open_spawn(store, "sa-aaaa1111", dispatch_id="dsp-1")
    # Occupy the mailbox path with a directory so os.replace() cannot succeed.
    (store.root / "sa-aaaa1111.mailbox.json").mkdir()

    with pytest.raises(dispatch_store.DispatchMailboxError):
        _claim(store, "sa-aaaa1111", "dsp-1", "m-1")


def test_claim_mail_rejects_an_empty_message_id(tmp_path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("HOME", str(tmp_path))
    store = SubAgentRunStore(OWNER)
    _open_spawn(store, "sa-aaaa1111", dispatch_id="dsp-1")
    with pytest.raises(ValueError):
        _claim(store, "sa-aaaa1111", "dsp-1", "")


def test_find_dispatch_prefers_exact_ids_then_aliases(tmp_path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("HOME", str(tmp_path))
    store = SubAgentRunStore(OWNER)
    _open_spawn(store, "sa-aaaa1111", dispatch_id="dsp-000000000001", name="scout")
    _open_spawn(store, "sa-bbbb2222", dispatch_id="dsp-000000000002", name="scout")
    _open_spawn(store, "dlg-cccc3333", dispatch_id="", name="delegate", kind="delegate")
    # A dispatch-registered worker whose name fell back to its run id must not match "scout".
    _open_spawn(store, "sa-dddd4444", dispatch_id="dsp-000000000004", name="")
    store.update_status("sa-bbbb2222", status="completed")

    assert dispatch_store.find_dispatch(store, "sa-aaaa1111") == (store.get_run("sa-aaaa1111"), "agent_id")

    record, kind = dispatch_store.find_dispatch(store, "dsp-000000000002")
    assert (record.run_id, kind) == ("sa-bbbb2222", "dispatch_id")

    record, kind = dispatch_store.find_dispatch(store, "Scout")
    assert (record.run_id, kind) == ("sa-bbbb2222", "name")

    assert dispatch_store.find_dispatch(store, "dlg-cccc3333") == (None, "")
    assert dispatch_store.find_dispatch(store, "nobody") == (None, "")
    assert dispatch_store.find_dispatch(store, "") == (None, "")


def test_set_dispatch_state_round_trips_through_detail_refs(tmp_path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("HOME", str(tmp_path))
    store = SubAgentRunStore(OWNER)
    _open_spawn(store, "sa-aaaa1111", dispatch_id="dsp-1")
    _open_spawn(store, "sa-legacy0000", dispatch_id="")

    assert dispatch_store.set_dispatch_state(store, "sa-aaaa1111", dispatch_store.DISPATCH_STATE_WAITING) is True
    dispatch = dispatch_store.dispatch_of(store.get_run("sa-aaaa1111"))
    assert dispatch["state"] == "waiting"
    assert dispatch["dispatch_id"] == "dsp-1"
    assert dispatch["task_id"] == "sa-aaaa1111"

    assert dispatch_store.set_dispatch_state(store, "sa-zzzz9999", dispatch_store.DISPATCH_STATE_WAITING) is False
    assert dispatch_store.set_dispatch_state(store, "sa-legacy0000", dispatch_store.DISPATCH_STATE_WAITING) is False


def test_context_snapshot_round_trip(tmp_path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("HOME", str(tmp_path))
    store = SubAgentRunStore(OWNER)
    _open_spawn(store, "sa-aaaa1111", dispatch_id="dsp-1")
    assert dispatch_store.read_context_snapshot(store, "sa-aaaa1111") is None

    dispatch_store.write_context_snapshot(
        store,
        "sa-aaaa1111",
        {"agent_messages": [{"role": "user", "content": "hi"}], "final_text": "done"},
    )

    snapshot = dispatch_store.read_context_snapshot(store, "sa-aaaa1111")
    assert snapshot["agent_messages"] == [{"role": "user", "content": "hi"}]
    assert snapshot["final_text"] == "done"
    assert snapshot["agent_id"] == "sa-aaaa1111"
    assert snapshot["schema_version"] == dispatch_store.AUX_SCHEMA_VERSION
    assert (store.root / "sa-aaaa1111.context.json").exists()
    assert not (store.root / "sa-aaaa1111.mailbox.json").exists()


def test_dispatch_ledger_session_id_is_a_valid_ledger_id() -> None:
    namespace = dispatch_store.dispatch_ledger_session_id("sess-abc", "sa-aaaa1111")
    assert namespace == "sess-abc:dispatch:sa-aaaa1111"
    assert LEDGER_ID_PATTERN.fullmatch(namespace)


def test_ledger_root_is_none_without_an_owner_session() -> None:
    assert dispatch_store.ledger_root_for(SubAgentRunStore(None)) is None


def test_worker_ledger_namespace_never_shadows_the_owner_session(tmp_path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("HOME", str(tmp_path))
    store = SubAgentRunStore(OWNER)
    sessions_root = dispatch_store.ledger_root_for(store)
    assert sessions_root == tmp_path / ".agenticx" / "sessions"
    ledger = ReplayLedgerStore(sessions_root)
    namespace = dispatch_store.dispatch_ledger_session_id(OWNER, "sa-aaaa1111")

    ledger.open_run(
        ReplayRunRecord(
            run_id="parent-run",
            session_id=OWNER,
            turn_id="turn-parent",
            agent_id="meta",
            status="running",
            created_at=1.0,
            updated_at=1.0,
        )
    )
    # A worker wake-up run left open by a crash is newer than the parent's run.
    ledger.open_run(
        ReplayRunRecord(
            run_id="worker-run",
            session_id=namespace,
            turn_id="turn-worker",
            agent_id="sa-aaaa1111",
            status="running",
            created_at=2.0,
            updated_at=2.0,
        )
    )

    assert find_open_run(ledger, OWNER).run_id == "parent-run"
    assert [run.run_id for run in ledger.list_runs(OWNER)] == ["parent-run"]
    assert [run.run_id for run in ledger.list_runs(namespace)] == ["worker-run"]
    assert ledger.get_run("worker-run") is not None


def test_delete_dispatch_ledger_runs_removes_namespaced_runs(tmp_path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("HOME", str(tmp_path))
    store = SubAgentRunStore(OWNER)
    _open_spawn(store, "sa-aaaa1111", dispatch_id="dsp-1")
    _open_spawn(store, "sa-legacy0000", dispatch_id="")
    sessions_root = dispatch_store.ledger_root_for(store)
    ledger = ReplayLedgerStore(sessions_root)
    namespace = dispatch_store.dispatch_ledger_session_id(OWNER, "sa-aaaa1111")
    ledger.open_run(
        ReplayRunRecord(
            run_id="worker-run",
            session_id=namespace,
            turn_id="turn-worker",
            agent_id="sa-aaaa1111",
            status="completed",
            created_at=2.0,
            updated_at=2.0,
        )
    )

    assert dispatch_store.delete_dispatch_ledger_runs(OWNER, sessions_root=sessions_root) == 1
    assert ledger.list_runs(namespace) == []
```

#### 1.2 实现

**(a) `agenticx/runtime/harden_flags.py`**：在 `:144`（`fresh_round_loop_enabled` 的 `return`）与 `:147`（`def cancelled_prefix_finalize_enabled`）之间插入，前后各留两个空行：

```python
def dispatch_mailbox_enabled() -> bool:
    """Persist dispatch records, mail claims, and context snapshots for wake-ups."""
    return _resolve_bool("AGX_DISPATCH_MAILBOX", "runtime.dispatch_mailbox", True)
```

**(b) `agenticx/runtime/subagent_runs/store.py`**

把 `:13-16`：

```python
import time
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple
```

替换为：

```python
import time
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Dict, Iterator, List, Optional, Tuple
```

把 `:36-39` 的 TODO(HA) 四行替换为：

```python
    TODO(HA): run records stay on local disk even when the session storage
    backend is redis (Plan A scope decision). Moving run timelines into the
    shared backend is a follow-up once multi-replica subagent observability
    is required. Dispatch mailboxes and context snapshots (``*.mailbox.json``,
    ``*.context.json``) share the same local-disk scope, so a wake-up is only
    guaranteed on the host that owns this directory.
```

在 `:206`（`merge_detail_refs` 的 `return record`）与 `:208`（`def update_model(`）之间插入：

```python
    def read_aux_json(self, run_id: str, suffix: str) -> Optional[Dict[str, Any]]:
        """Read one per-run auxiliary JSON document (mailbox, context snapshot)."""
        rid = str(run_id or "").strip()
        if not rid:
            return None
        path = self._root / f"{self._safe_name(rid)}.{self._safe_name(suffix)}.json"
        try:
            payload = json.loads(path.read_text("utf-8"))
        except (OSError, ValueError):
            return None
        return payload if isinstance(payload, dict) else None

    def write_aux_json(self, run_id: str, suffix: str, payload: Dict[str, Any]) -> None:
        """Atomically replace one per-run auxiliary JSON document.

        Raises whatever the atomic writer raises so callers can fail closed.
        """
        rid = str(run_id or "").strip()
        if not rid or not isinstance(payload, dict):
            raise ValueError("run_id and a dict payload are required")
        with self._lock:
            self._ensure_root()
            self._write_json(
                self._root / f"{self._safe_name(rid)}.{self._safe_name(suffix)}.json",
                payload,
            )

    @contextmanager
    def locked(self) -> Iterator[None]:
        """Hold the per-root lock so a read-modify-write over auxiliary files is atomic."""
        with self._lock:
            self._ensure_root()
            yield

```

**(c) 新建 `agenticx/runtime/subagent_runs/dispatch.py`**（完整内容）：

```python
"""Persistent dispatch records, mailbox claims, and context snapshots.

A *dispatch* is one delegated unit of work. It is 1:1 with a spawned sub-agent
run and persists the identity needed to address that unit after a process
restart: ``dispatch_id``, ``task_id`` (the worker run id), the parent task and
the work unit. The record lives under ``detail_refs["dispatch"]`` of the run
record, so it follows the run record's lifecycle and local-disk scope.

A *mail* is one instruction addressed to a dispatch. Every accepted mail is
written to the worker's mailbox as consumed *before* any execution starts, so
re-delivering the same ``message_id`` never executes twice. The guarantee is
at-most-once, not exactly-once: a crash between the persisted claim and the
end of the turn loses that mail.

Author: Damon Li
"""

from __future__ import annotations

import time
import uuid
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from agenticx.runtime.subagent_runs.contracts import RunRecord
from agenticx.runtime.subagent_runs.store import SubAgentRunStore

DISPATCH_DETAIL_KEY = "dispatch"
DISPATCH_ID_PREFIX = "dsp-"
DISPATCH_STATE_RUNNING = "running"
DISPATCH_STATE_WAITING = "waiting"
DISPATCH_STATE_CLOSED = "closed"
LEDGER_NAMESPACE = "dispatch"
MAILBOX_SUFFIX = "mailbox"
CONTEXT_SUFFIX = "context"
AUX_SCHEMA_VERSION = 1
MAILBOX_KEEP = 50


class DispatchMailboxError(RuntimeError):
    """Identify a mailbox or snapshot file that could not be written."""


def new_dispatch_id() -> str:
    """Mint the addressable id of one delegation unit."""
    return f"{DISPATCH_ID_PREFIX}{uuid.uuid4().hex[:12]}"


def dispatch_ledger_session_id(owner_session_id: str, agent_id: str) -> str:
    """Return the ledger session namespace that isolates one worker's wake-up turns."""
    owner = str(owner_session_id or "").strip()
    return f"{owner}:{LEDGER_NAMESPACE}:{str(agent_id or '').strip()}"


def ledger_root_for(store: SubAgentRunStore) -> Optional[Path]:
    """Return the sessions root that hosts a per-session run store."""
    if not store.owner_session_id:
        return None
    return store.root.parent.parent


def dispatch_of(record: Optional[RunRecord]) -> Dict[str, Any]:
    """Return the persisted dispatch record of one run, or an empty dict."""
    payload = (record.detail_refs or {}).get(DISPATCH_DETAIL_KEY) if record is not None else None
    return dict(payload) if isinstance(payload, dict) else {}


def build_dispatch_detail(context: Any) -> Dict[str, Any]:
    """Build the dispatch record of a freshly spawned worker."""
    return {
        "dispatch_id": context.dispatch_id,
        "task_id": context.agent_id,
        "parent_agent_id": context.parent_agent_id,
        "parent_tool_call_id": context.source_tool_call_id,
        "work_unit": context.task,
        "depth": int(context.depth or 1),
        "mode": context.mode,
        "cleanup": context.cleanup,
        "run_timeout_seconds": int(context.run_timeout_seconds),
        "inherit_parent_context": bool(context.inherit_parent_context),
        "spawn_tree_path": context.spawn_tree_path,
        "workspace_dir": context.workspace_dir,
        "state": DISPATCH_STATE_RUNNING,
    }


def find_dispatch(store: SubAgentRunStore, query: str) -> Tuple[Optional[RunRecord], str]:
    """Find the spawned worker a mail address refers to.

    Returns ``(record, match_kind)`` where ``match_kind`` is ``"agent_id"``,
    ``"dispatch_id"``, ``"name"`` or ``"avatar_id"``. Exact identifiers win over
    aliases; among aliases the most recently updated run wins.
    """
    needle = str(query or "").strip()
    if not needle:
        return None, ""
    lowered = needle.lower()
    try:
        records = [record for record in store.list_runs() if record.kind == "spawn"]
    except Exception:
        return None, ""
    for record in records:
        if record.run_id == needle:
            return record, "agent_id"
    for record in records:
        dispatch_id = str(dispatch_of(record).get("dispatch_id") or "")
        if dispatch_id and dispatch_id == needle:
            return record, "dispatch_id"
    best: Optional[RunRecord] = None
    kind = ""
    for record in records:
        if not dispatch_of(record).get("dispatch_id"):
            continue
        if str(record.name or "").strip().lower() == lowered:
            matched = "name"
        elif str(record.avatar_id or "").strip().lower() == lowered:
            matched = "avatar_id"
        else:
            continue
        if best is None or float(record.updated_at or 0) > float(best.updated_at or 0):
            best, kind = record, matched
    if best is None:
        return None, ""
    return best, kind


def set_dispatch_state(store: SubAgentRunStore, run_id: str, state: str) -> bool:
    """Move one dispatch between ``running``, ``waiting`` and ``closed``."""
    try:
        with store.locked():
            record = store.get_run(run_id)
            dispatch = dispatch_of(record)
            if not dispatch.get("dispatch_id"):
                return False
            dispatch["state"] = state
            dispatch["state_changed_at"] = time.time()
            return store.merge_detail_refs(run_id, {DISPATCH_DETAIL_KEY: dispatch}) is not None
    except Exception:
        return False


def claim_mail(
    store: SubAgentRunStore,
    run_id: str,
    *,
    dispatch_id: str,
    message_id: str,
    text: str,
    consumed_by: str,
) -> Tuple[bool, Dict[str, Any]]:
    """Persist one mail as consumed unless its ``message_id`` was already claimed.

    Returns ``(True, mail)`` for a fresh mail and ``(False, existing)`` for a
    duplicate. Raises ``DispatchMailboxError`` when the claim cannot be
    persisted; callers must then refuse to execute.
    """
    mid = str(message_id or "").strip()
    if not mid:
        raise ValueError("message_id must not be empty")
    try:
        with store.locked():
            payload = store.read_aux_json(run_id, MAILBOX_SUFFIX) or {}
            mails = [item for item in (payload.get("mails") or []) if isinstance(item, dict)]
            for mail in mails:
                if str(mail.get("message_id") or "") == mid:
                    return False, dict(mail)
            mail = {
                "message_id": mid,
                "dispatch_id": dispatch_id,
                "text": text,
                "state": "consumed",
                "consumed_by": consumed_by,
                "consumed_at": time.time(),
            }
            mails.append(mail)
            store.write_aux_json(
                run_id,
                MAILBOX_SUFFIX,
                {
                    "schema_version": AUX_SCHEMA_VERSION,
                    "dispatch_id": dispatch_id,
                    "agent_id": run_id,
                    "mails": mails[-MAILBOX_KEEP:],
                },
            )
            return True, dict(mail)
    except DispatchMailboxError:
        raise
    except Exception as exc:
        raise DispatchMailboxError(f"mail claim failed for {run_id}") from exc


def read_mailbox(store: SubAgentRunStore, run_id: str) -> List[Dict[str, Any]]:
    """Return the persisted mails of one dispatch, oldest first."""
    payload = store.read_aux_json(run_id, MAILBOX_SUFFIX) or {}
    return [dict(item) for item in (payload.get("mails") or []) if isinstance(item, dict)]


def write_context_snapshot(store: SubAgentRunStore, run_id: str, payload: Dict[str, Any]) -> None:
    """Persist the rebuildable context of one waiting worker."""
    body: Dict[str, Any] = {"schema_version": AUX_SCHEMA_VERSION, "agent_id": run_id}
    body.update(payload or {})
    try:
        store.write_aux_json(run_id, CONTEXT_SUFFIX, body)
    except Exception as exc:
        raise DispatchMailboxError(f"context snapshot failed for {run_id}") from exc


def read_context_snapshot(store: SubAgentRunStore, run_id: str) -> Optional[Dict[str, Any]]:
    """Return the persisted context snapshot of one worker, or None."""
    return store.read_aux_json(run_id, CONTEXT_SUFFIX)


def delete_dispatch_ledger_runs(owner_session_id: str, *, sessions_root: Path) -> int:
    """Delete the namespaced wake-up ledger runs of every dispatch in one session."""
    try:
        from agenticx.runtime.replay_ledger.store import ReplayLedgerStore

        records = SubAgentRunStore(owner_session_id).list_runs()
    except Exception:
        return 0
    ledger = ReplayLedgerStore(sessions_root)
    deleted = 0
    for record in records:
        if not dispatch_of(record).get("dispatch_id"):
            continue
        try:
            ledger.delete_session_runs(
                dispatch_ledger_session_id(owner_session_id, record.run_id)
            )
            deleted += 1
        except Exception:
            continue
    return deleted
```

#### 1.3 依赖的现有 API

| API | 出处 | 依赖的行为 |
| --- | --- | --- |
| `SubAgentRunStore(owner_session_id)`；`.owner_session_id`；`.root` | `store.py:48-71` | 根目录 `~/.agenticx/sessions/<owner>/subagent_runs`；无 owner 时根为 `~/.agenticx/subagent_runs` |
| `SubAgentRunStore._safe_name`（静态） | `store.py:608-610` | 只保留字母数字与 `-_.` |
| `SubAgentRunStore._ensure_root` | `store.py:612-613` | `mkdir(parents=True, exist_ok=True)` |
| `SubAgentRunStore._write_json`（静态） | `store.py:660-683` | mkstemp + fsync + `os.replace`；失败删临时文件并重新抛出 |
| `SubAgentRunStore._lock` | `store.py:61-66` | 按解析后的根目录共享的 `threading.RLock`，可重入 |
| `open_run(*, run_id, kind, name, role, task, status, …, detail_refs)` | `store.py:73-146` | `status` 必填；`detail_refs` 原样存入 |
| `list_runs()`、`get_run(run_id)`、`update_status(run_id, *, status)`、`merge_detail_refs(run_id, detail_refs)` | `store.py:354`、`:367`、`:148-183`、`:185-206` | `merge_detail_refs` 按键合并、跳过 `None`、返回记录或 `None` |
| `RunRecord.kind`、`.run_id`、`.name`、`.avatar_id`、`.updated_at`、`.detail_refs` | `contracts.py:81-105` | 字段名与类型 |
| `_resolve_bool(env_name, config_key, default)` | `harden_flags.py:57-64` | 环境变量优先于配置，缺省取 `default` |
| `ReplayLedgerStore(sessions_root)`、`.open_run(record)`、`.list_runs(session_id)`、`.get_run(run_id)`、`.delete_session_runs(session_id)` | `replay_ledger/store.py:70-75`、`:269`、`:375-388`、`:362`、`:588` | `list_runs` 只扫 `<sid>/runs/*/run.json` |
| `ReplayRunRecord(run_id, session_id, turn_id, agent_id, status, created_at, updated_at, …)` | `replay_ledger/contracts.py:74-88` | 位置字段顺序 |
| `LEDGER_ID_PATTERN` | `replay_ledger/contracts.py:18` | `^[A-Za-z0-9._:-]{1,128}$` |
| `find_open_run(store, session_id)` | `resume_anchor.py:41-52` | 取最新 run，仅 `running` 时返回 |

#### 1.4 验证

```bash
/opt/miniconda3/bin/python3 -m pytest tests/test_subagent_dispatch_mailbox.py -q --no-cov
/opt/miniconda3/bin/python3 -m pytest tests/test_smoke_subagent_run_store.py tests/test_subagent_run_resolver.py -q --no-cov
```

预期：第一行全部通过（规划阶段未执行，基线数字待实施开始时补测）；第二行与实施前一致。

### Task 2：生命周期接线（`team_manager.py`：dispatch 记录、挂起态、快照）

**目的**：worker 一 spawn 就有 dispatch 记录；回合结束时进入 `waiting` 并写上下文快照；取消时置 `closed`；状态行暴露 `dispatch_id`。本任务不做唤醒。

#### 2.1 先写失败的测试

新建 `tests/test_subagent_dispatch_lifecycle.py`（完整内容）：

```python
"""Lifecycle tests for persisted dispatch records of spawned sub-agents.

Plan-Id: 2026-11-27-runtime-invariants-03-dispatch-mailbox

Author: Damon Li
"""

from __future__ import annotations

import asyncio
import json
from typing import Any, List

import pytest

from agenticx.cli.studio import StudioSession
from agenticx.runtime import meta_tools
from agenticx.runtime.subagent_runs import SubAgentRunStore
from agenticx.runtime.subagent_runs import dispatch as dispatch_store
from agenticx.runtime.subagent_runs.resolver import list_resolved_runs
from agenticx.runtime.team_manager import AgentTeamManager

OWNER = "sess-dispatch-lifecycle"


class _FakeResponse:
    def __init__(self, content: str, tool_calls: List[Any]) -> None:
        self.content = content
        self.tool_calls = tool_calls


class _QuickTextLLM:
    def __init__(self, reply: str = "done") -> None:
        self.reply = reply

    def invoke(self, *_args: Any, **_kwargs: Any) -> _FakeResponse:
        return _FakeResponse(self.reply, [])

    def stream(self, *_args: Any, **_kwargs: Any):
        yield self.reply


async def _wait_until(predicate, timeout: float = 5.0) -> None:
    started = asyncio.get_running_loop().time()
    while not predicate():
        await asyncio.sleep(0.02)
        if (asyncio.get_running_loop().time() - started) > timeout:
            raise TimeoutError("condition not met in time")


def _record(run_id: str):
    record = SubAgentRunStore(OWNER).get_run(run_id)
    assert record is not None
    return record


def _dispatch(run_id: str) -> dict:
    return dispatch_store.dispatch_of(_record(run_id))


async def _spawn_and_settle(manager: AgentTeamManager, name: str = "worker-a") -> str:
    spawned = await manager.spawn_subagent(name=name, role="worker", task="write a short note")
    assert spawned["ok"] is True
    run_id = spawned["agent_id"]
    await _wait_until(lambda: _dispatch(run_id).get("state") == dispatch_store.DISPATCH_STATE_WAITING)
    return run_id


def test_turn_end_persists_waiting_state_and_context_snapshot(tmp_path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("HOME", str(tmp_path))

    async def _run() -> None:
        manager = AgentTeamManager(
            llm_factory=lambda: _QuickTextLLM("first-answer"),
            base_session=StudioSession(),
            owner_session_id=OWNER,
        )
        spawned = await manager.spawn_subagent(name="worker-a", role="worker", task="write a short note")
        assert spawned["ok"] is True
        assert "dispatch_id" not in spawned
        run_id = spawned["agent_id"]
        await _wait_until(lambda: _dispatch(run_id).get("state") == dispatch_store.DISPATCH_STATE_WAITING)

        record = _record(run_id)
        assert record.status == "completed"
        dispatch = dispatch_store.dispatch_of(record)
        assert dispatch["dispatch_id"].startswith("dsp-")
        assert dispatch["task_id"] == run_id
        assert dispatch["parent_agent_id"] == "meta"
        assert dispatch["work_unit"] == "write a short note"
        assert dispatch["mode"] == "run"
        assert dispatch["cleanup"] == "keep"
        assert dispatch["depth"] == 1
        assert dispatch["state"] == "waiting"

        snapshot = dispatch_store.read_context_snapshot(SubAgentRunStore(OWNER), run_id)
        assert snapshot is not None
        assert any(
            row.get("role") == "user" and "write a short note" in str(row.get("content"))
            for row in snapshot["agent_messages"]
        )
        assert "first-answer" in json.dumps(snapshot["agent_messages"], ensure_ascii=False)
        assert snapshot["allowed_tool_names"]
        assert not (SubAgentRunStore(OWNER).root / f"{run_id}.mailbox.json").exists()

    asyncio.run(_run())


def test_dispatch_is_visible_in_resolved_rows_and_status_tool(tmp_path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("HOME", str(tmp_path))

    async def _run() -> None:
        manager = AgentTeamManager(
            llm_factory=lambda: _QuickTextLLM(),
            base_session=StudioSession(),
            owner_session_id=OWNER,
        )
        run_id = await _spawn_and_settle(manager)
        dispatch_id = _dispatch(run_id)["dispatch_id"]

        rows = list_resolved_runs(OWNER, team_manager=manager)
        row = next(item for item in rows if item["agent_id"] == run_id)
        assert row["detail_refs"]["dispatch"]["dispatch_id"] == dispatch_id
        assert row["detail_refs"]["dispatch"]["state"] == "waiting"

        raw = await meta_tools.dispatch_meta_tool_async(
            "query_subagent_status", {"agent_id": run_id}, team_manager=manager
        )
        assert dispatch_id in raw

    asyncio.run(_run())


def test_cancelled_worker_closes_its_dispatch(tmp_path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("HOME", str(tmp_path))

    async def _run() -> None:
        manager = AgentTeamManager(
            llm_factory=lambda: _QuickTextLLM(),
            base_session=StudioSession(),
            owner_session_id=OWNER,
        )
        run_id = await _spawn_and_settle(manager)

        cancelled = await manager.cancel_subagent(run_id)
        assert cancelled["ok"] is True
        assert _record(run_id).status == "cancelled"
        assert _dispatch(run_id)["state"] == dispatch_store.DISPATCH_STATE_CLOSED

    asyncio.run(_run())


def test_switch_off_keeps_the_legacy_record_shape(tmp_path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("AGX_DISPATCH_MAILBOX", "0")
    monkeypatch.setenv("HOME", str(tmp_path))

    async def _run() -> None:
        manager = AgentTeamManager(
            llm_factory=lambda: _QuickTextLLM(),
            base_session=StudioSession(),
            owner_session_id=OWNER,
        )
        spawned = await manager.spawn_subagent(name="worker-a", role="worker", task="write a short note")
        run_id = spawned["agent_id"]
        await _wait_until(lambda: _record(run_id).status == "completed")

        assert dispatch_store.dispatch_of(_record(run_id)) == {}
        assert _record(run_id).detail_refs["scratchpad_key"] == f"subagent_result::{run_id}"
        assert dispatch_store.read_context_snapshot(SubAgentRunStore(OWNER), run_id) is None
        assert not (SubAgentRunStore(OWNER).root / f"{run_id}.context.json").exists()

    asyncio.run(_run())
```

#### 2.2 实现：`agenticx/runtime/team_manager.py`

**(a) imports**：在 `:36`（`from agenticx.runtime.subagent_runs import SubAgentRunStore`）之后插入两行：

```python
from agenticx.runtime.harden_flags import dispatch_mailbox_enabled
from agenticx.runtime.subagent_runs import dispatch as dispatch_store
```

**(b) `SubAgentContext`**：在 `:157`（`badge_seq: str = ""`）之后插入：

```python
    dispatch_id: str = ""
```

**(c) spawn**：在 `:588`（`inherit_parent_context=bool(inherit_parent_context),`）之后插入：

```python
                dispatch_id=dispatch_store.new_dispatch_id() if dispatch_mailbox_enabled() else "",
```

**(d) `_run_store_open`**：把 `:1212-1214`：

```python
                detail_refs={
                    "scratchpad_key": f"subagent_result::{context.agent_id}",
                },
```

替换为：

```python
                detail_refs=self._run_store_detail_refs(context),
```

**(e) 新方法**：在 `:1258`（`_run_store_close` 的 `_log.warning(... close_run failed ...)`）与 `:1260`（`async def _run_subagent(`）之间插入：

```python
    def _run_store_detail_refs(self, context: SubAgentContext) -> Dict[str, Any]:
        """Build the detail refs persisted with a newly opened run record."""
        detail_refs: Dict[str, Any] = {"scratchpad_key": f"subagent_result::{context.agent_id}"}
        if context.dispatch_id:
            detail_refs[dispatch_store.DISPATCH_DETAIL_KEY] = dispatch_store.build_dispatch_detail(context)
        return detail_refs

    def _dispatch_suspend(self, context: SubAgentContext) -> None:
        """Persist the suspended state and context snapshot of one dispatch at turn end."""
        if not context.dispatch_id:
            return
        closed = context.status == SubAgentStatus.CANCELLED or context.cleanup == "delete"
        if closed:
            dispatch_store.set_dispatch_state(
                self._run_store, context.agent_id, dispatch_store.DISPATCH_STATE_CLOSED
            )
            return
        try:
            dispatch_store.write_context_snapshot(
                self._run_store,
                context.agent_id,
                {
                    "agent_messages": list(context.agent_messages),
                    "artifacts": {str(key): value for key, value in context.artifacts.items()},
                    "context_files": dict(context.context_files),
                    "attachments": dict(context.attachments),
                    "allowed_tool_names": list(context.allowed_tool_names),
                    "final_text": context.final_text,
                    "failure_count": context.failure_count,
                    "escalation_level": context.escalation_level,
                    "pause_detector": context.pause_detector,
                    "pause_retryable": context.pause_retryable,
                    "written_at": time.time(),
                },
            )
        except Exception as exc:  # noqa: BLE001
            _log.warning("[dispatch] context snapshot failed for %s: %s", context.agent_id, exc)
            return
        dispatch_store.set_dispatch_state(
            self._run_store, context.agent_id, dispatch_store.DISPATCH_STATE_WAITING
        )
```

**(f) 回合结束**：把 `:1559`：

```python
            self._run_store_close(context, produced_files)
```

替换为：

```python
            self._dispatch_suspend(context)
            self._run_store_close(context, produced_files)
```

（该行在文件中唯一；`_run_store_close` 只在这里被调用。）

**(g) 取消关闭**：把 `:658-664`：

```python
        try:
            self._run_store.update_status(
                agent_id,
                status=context.status.value,
                error_text="任务已取消",
                completed_at=context.updated_at,
            )
```

替换为：

```python
        try:
            self._run_store.update_status(
                agent_id,
                status=context.status.value,
                error_text="任务已取消",
                completed_at=context.updated_at,
            )
            if context.dispatch_id:
                dispatch_store.set_dispatch_state(
                    self._run_store, agent_id, dispatch_store.DISPATCH_STATE_CLOSED
                )
```

**(h) 状态行**：把 `:1169`（`"avatar_id": context.avatar_id or None,`）替换为：

```python
            "avatar_id": context.avatar_id or None,
            "dispatch_id": context.dispatch_id or "",
```

#### 2.3 依赖的现有 API

| API | 出处 | 依赖的行为 |
| --- | --- | --- |
| `SubAgentContext` 的全部字段名（`agent_id` … `badge_seq`） | `team_manager.py:116-157` | 新字段追加在末尾，所有构造点都用关键字参数（`:563-589`）或 `replace`（`:1174-1181`） |
| `spawn_subagent(*, name, role, task, …)` | `team_manager.py:480-499`、返回 `:632-645` | 只在函数体内多赋一个字段；参数与返回不动 |
| `_run_store_open` → `open_run(detail_refs=...)` | `team_manager.py:1196-1219` | `detail_refs` 原样落盘 |
| `close_run(..., detail_refs=...)` 按键合并、跳过 `None` | `store.py:294-334`（合并在 `:331-334`）、`team_manager.py:1241-1256` | 封口时不会抹掉 `dispatch` 键 |
| `cancel_subagent` | `team_manager.py:647-677` | `update_status` 在 `try` 内 |
| `_run_subagent` 的 `finally` 顺序 | `team_manager.py:1470-1582` | `:1479` 同步 `agent_messages`；`:1555-1558` 升级分支先返回；`:1559` 封口 |
| `_serialize_status` | `team_manager.py:1122-1170` | 末尾追加一个键 |
| `list_resolved_runs(owner_session_id, *, session_manager=None, team_manager=None, include_legacy=False)` | `resolver.py:177-218`；行由 `record.to_dict()` 生成 `:164-174` | 行里带 `detail_refs` |
| `meta_tools.dispatch_meta_tool_async(name, arguments, *, team_manager, session=None)` | `meta_tools.py:2785-2791` | 返回 JSON 字符串 |
| `AgentTeamManager(llm_factory=, base_session=, owner_session_id=)` | `team_manager.py:164-198` | 构造时建 `SubAgentRunStore(owner_session_id)` |
| 真实 `AgentRuntime` + `_FakeResponse(content, tool_calls)` 假 LLM | `tests/test_smoke_subagent_run_store.py:31-42`、`:149-187` | 既有冒烟测试的夹具写法 |

#### 2.4 验证

```bash
/opt/miniconda3/bin/python3 -m pytest tests/test_subagent_dispatch_lifecycle.py tests/test_subagent_dispatch_mailbox.py -q --no-cov
/opt/miniconda3/bin/python3 -m pytest tests/test_team_manager.py tests/test_meta_tools.py tests/test_enhanced_spawn.py tests/test_work_item_runtime.py tests/test_smoke_subagent_run_store.py tests/test_subagent_run_resolver.py tests/test_smoke_subagent_completion.py tests/test_smoke_cc_stability_m5.py tests/test_meta_group_tools.py -q --no-cov
```

预期：第一行全部通过；第二行（master plan 点名的相关既有测试）与实施前一致。

### Task 3：唤醒与幂等（`send_message_to_subagent`、上下文重建、`meta_tools`）

**目的**：重启后一封邮件能把 `waiting` 的 worker 找回、还原上下文、只执行一次。本任务不接账本（`_run_subagent` 先只接收 `wake_mail`，Task 4 再使用它）。

#### 3.1 先写失败的测试

新建 `tests/test_dispatch_wake_after_restart.py`（完整内容）：

```python
"""Closed-loop tests for dispatch wake-ups across a backend restart.

Plan-Id: 2026-11-27-runtime-invariants-03-dispatch-mailbox

Author: Damon Li
"""

from __future__ import annotations

import asyncio
import json
from typing import Any, List

import pytest

from agenticx.cli.studio import StudioSession
from agenticx.runtime import meta_tools
from agenticx.runtime.subagent_runs import SubAgentRunStore
from agenticx.runtime.subagent_runs import dispatch as dispatch_store
from agenticx.runtime.team_manager import AgentTeamManager

OWNER = "sess-dispatch-wake"
MAIL = "continue: write the second note"


class _FakeResponse:
    def __init__(self, content: str, tool_calls: List[Any]) -> None:
        self.content = content
        self.tool_calls = tool_calls


class _RecordingLLM:
    """Fake LLM that counts invocations and keeps what the model was shown."""

    def __init__(self, reply: str) -> None:
        self.reply = reply
        self.calls = 0
        self.seen: List[str] = []

    def invoke(self, *args: Any, **kwargs: Any) -> _FakeResponse:
        self.calls += 1
        self.seen.append(json.dumps([args, kwargs], ensure_ascii=False, default=str))
        return _FakeResponse(self.reply, [])

    def stream(self, *args: Any, **kwargs: Any):
        self.calls += 1
        self.seen.append(json.dumps([args, kwargs], ensure_ascii=False, default=str))
        yield self.reply


async def _wait_until(predicate, timeout: float = 5.0) -> None:
    started = asyncio.get_running_loop().time()
    while not predicate():
        await asyncio.sleep(0.02)
        if (asyncio.get_running_loop().time() - started) > timeout:
            raise TimeoutError("condition not met in time")


def _new_manager(llm: Any) -> AgentTeamManager:
    """A fresh manager for the same owner session, i.e. a backend restart."""
    return AgentTeamManager(
        llm_factory=lambda: llm,
        base_session=StudioSession(),
        owner_session_id=OWNER,
    )


def _dispatch(run_id: str) -> dict:
    record = SubAgentRunStore(OWNER).get_run(run_id)
    assert record is not None
    return dispatch_store.dispatch_of(record)


def _snapshot(run_id: str):
    return dispatch_store.read_context_snapshot(SubAgentRunStore(OWNER), run_id)


async def _spawn_and_settle(manager: AgentTeamManager, name: str = "worker-a") -> str:
    spawned = await manager.spawn_subagent(name=name, role="worker", task="write a short note")
    assert spawned["ok"] is True
    run_id = spawned["agent_id"]
    await _wait_until(lambda: _dispatch(run_id).get("state") == dispatch_store.DISPATCH_STATE_WAITING)
    return run_id


def test_waiting_worker_is_woken_once_after_restart_with_context(tmp_path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("HOME", str(tmp_path))

    async def _run() -> None:
        llm = _RecordingLLM("first-answer")
        run_id = await _spawn_and_settle(_new_manager(llm))
        first_snapshot = _snapshot(run_id)
        assert first_snapshot is not None
        dispatch_id = _dispatch(run_id)["dispatch_id"]
        calls_before = llm.calls

        # Backend restart: a fresh manager whose in-memory maps are empty.
        second = _new_manager(llm)
        woken = await second.send_message_to_subagent(run_id, MAIL, message_id="mail-1")
        assert woken["ok"] is True
        assert woken.get("restored") is True
        assert woken["dispatch_id"] == dispatch_id
        assert woken["message_id"] == "mail-1"
        await _wait_until(lambda: _dispatch(run_id).get("state") == dispatch_store.DISPATCH_STATE_WAITING)

        calls_after_wake = llm.calls
        assert calls_after_wake > calls_before
        assert any("first-answer" in seen for seen in llm.seen[calls_before:])

        second_snapshot = _snapshot(run_id)
        assert second_snapshot is not None
        rows = second_snapshot["agent_messages"]
        assert any(row.get("role") == "user" and MAIL in str(row.get("content")) for row in rows)
        assert "first-answer" in json.dumps(rows, ensure_ascii=False)
        assert len(rows) > len(first_snapshot["agent_messages"])

        # The same mail again, in-process and after another restart, is a no-op.
        duplicate = await second.send_message_to_subagent(run_id, MAIL, message_id="mail-1")
        assert duplicate["ok"] is True
        assert duplicate.get("duplicate") is True
        third = _new_manager(llm)
        duplicate_again = await third.send_message_to_subagent(run_id, MAIL, message_id="mail-1")
        assert duplicate_again["ok"] is True
        assert duplicate_again.get("duplicate") is True
        await asyncio.sleep(0.2)
        assert llm.calls == calls_after_wake

        mails = dispatch_store.read_mailbox(SubAgentRunStore(OWNER), run_id)
        assert [item["message_id"] for item in mails] == ["mail-1"]
        assert mails[0]["consumed_by"] == "wake_turn"

        # A different mail is a new wake-up.
        again = await third.send_message_to_subagent(run_id, "third note", message_id="mail-2")
        assert again["ok"] is True
        assert "duplicate" not in again
        await _wait_until(
            lambda: len(dispatch_store.read_mailbox(SubAgentRunStore(OWNER), run_id)) == 2
            and _dispatch(run_id).get("state") == dispatch_store.DISPATCH_STATE_WAITING
        )
        assert llm.calls > calls_after_wake

    asyncio.run(_run())


def test_addressing_by_dispatch_id_and_name_after_restart(tmp_path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("HOME", str(tmp_path))

    async def _run() -> None:
        llm = _RecordingLLM("ok")
        run_id = await _spawn_and_settle(_new_manager(llm), name="scout")
        dispatch_id = _dispatch(run_id)["dispatch_id"]

        second = _new_manager(llm)
        by_dispatch = await second.send_message_to_subagent(dispatch_id, "by dispatch", message_id="m-dispatch")
        assert by_dispatch["ok"] is True
        assert by_dispatch["agent_id"] == run_id
        await _wait_until(lambda: _dispatch(run_id).get("state") == dispatch_store.DISPATCH_STATE_WAITING)

        third = _new_manager(llm)
        by_name = await third.send_message_to_subagent("scout", "by name", message_id="m-name")
        assert by_name["ok"] is True
        assert by_name["agent_id"] == run_id
        await _wait_until(lambda: _dispatch(run_id).get("state") == dispatch_store.DISPATCH_STATE_WAITING)

        unknown = await third.send_message_to_subagent("dsp-does-not-exist", "x")
        assert unknown == {"ok": False, "error": "not_found", "message": "未找到子智能体: dsp-does-not-exist"}

    asyncio.run(_run())


def test_cancelled_worker_is_closed_after_restart(tmp_path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("HOME", str(tmp_path))

    async def _run() -> None:
        llm = _RecordingLLM("ok")
        first = _new_manager(llm)
        run_id = await _spawn_and_settle(first)
        assert (await first.cancel_subagent(run_id))["ok"] is True
        calls_before = llm.calls

        refused = await _new_manager(llm).send_message_to_subagent(run_id, MAIL)
        assert refused["ok"] is False
        assert refused["error"] == "dispatch_closed"
        await asyncio.sleep(0.1)
        assert llm.calls == calls_before

    asyncio.run(_run())


def test_stale_running_record_without_snapshot_is_refused(tmp_path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("HOME", str(tmp_path))
    # A worker that crashed mid-turn: still "running", never reached "waiting".
    SubAgentRunStore(OWNER).open_run(
        run_id="sa-stale00000",
        kind="spawn",
        name="crashed",
        role="worker",
        task="crashed mid-turn",
        status="running",
        started_at=1.0,
        detail_refs={
            "dispatch": {"dispatch_id": "dsp-stale000001", "task_id": "sa-stale00000", "state": "running"}
        },
    )

    async def _run() -> None:
        llm = _RecordingLLM("should-not-run")
        refused = await _new_manager(llm).send_message_to_subagent("sa-stale00000", MAIL)
        assert refused["ok"] is False
        assert refused["error"] == "context_unavailable"
        await asyncio.sleep(0.1)
        assert llm.calls == 0

    asyncio.run(_run())


def test_legacy_record_without_dispatch_is_refused(tmp_path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("HOME", str(tmp_path))
    # A run record written before dispatches existed: no dispatch, no snapshot.
    SubAgentRunStore(OWNER).open_run(
        run_id="sa-legacy00001",
        kind="spawn",
        name="old",
        role="worker",
        task="old task",
        status="completed",
        started_at=1.0,
    )

    async def _run() -> None:
        llm = _RecordingLLM("should-not-run")
        refused = await _new_manager(llm).send_message_to_subagent("sa-legacy00001", MAIL)
        assert refused["ok"] is False
        assert refused["error"] == "dispatch_not_registered"
        await asyncio.sleep(0.1)
        assert llm.calls == 0

    asyncio.run(_run())


def test_send_message_tool_derives_message_id_from_the_tool_call(tmp_path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("HOME", str(tmp_path))

    async def _run() -> None:
        llm = _RecordingLLM("ok")
        run_id = await _spawn_and_settle(_new_manager(llm))
        dispatch_id = _dispatch(run_id)["dispatch_id"]
        second = _new_manager(llm)
        arguments = {"agent_id": dispatch_id, "message": MAIL, "__tool_call_id": "call-77"}

        first_raw = await meta_tools.dispatch_meta_tool_async(
            "send_message_to_agent", dict(arguments), team_manager=second
        )
        assert json.loads(first_raw)["ok"] is True
        await _wait_until(lambda: _dispatch(run_id).get("state") == dispatch_store.DISPATCH_STATE_WAITING)
        calls_after = llm.calls

        # The same tool call re-dispatched is the same mail.
        second_raw = await meta_tools.dispatch_meta_tool_async(
            "send_message_to_agent", dict(arguments), team_manager=second
        )
        assert json.loads(second_raw)["duplicate"] is True
        await asyncio.sleep(0.2)
        assert llm.calls == calls_after

        mails = dispatch_store.read_mailbox(SubAgentRunStore(OWNER), run_id)
        assert [item["message_id"] for item in mails] == ["call:call-77"]

    asyncio.run(_run())
```

#### 3.2 实现：`agenticx/runtime/team_manager.py`

**(a) 模块级定义**：在 `class AgentTeamManager:` 之前（`SubAgentContext` 定义之后）插入：

```python
_DISPATCH_ERRORS = {
    "dispatch_closed": "该子智能体已被取消，委派已关闭",
    "dispatch_not_registered": "该子智能体不是持久化委派，重启后无法唤醒",
    "context_unavailable": "该子智能体没有可恢复的上下文，无法唤醒",
}


def _status_from_persisted(status: str) -> SubAgentStatus:
    """Map a persisted run status to the in-memory status of a restored worker.

    A record still marked ``running`` has no live task after a restart, so it
    is treated like a paused worker that a mail may resume.
    """
    normalized = str(status or "").strip()
    if normalized in {"running", "pending"}:
        return SubAgentStatus.PAUSED
    try:
        return SubAgentStatus(normalized)
    except ValueError:
        return SubAgentStatus.PAUSED
```

**(b) 把 `send_message_to_subagent` 整个函数（Task 2 之后仍以 `async def send_message_to_subagent(self, agent_id: str, message: str) -> Dict[str, Any]:` 开头、以下一个 `def _ensure_agent_session` 之前的空行结束）替换为**：

```python
    async def send_message_to_subagent(
        self,
        agent_id: str,
        message: str,
        *,
        message_id: str = "",
    ) -> Dict[str, Any]:
        context = self._agents.get(agent_id)
        if context is None:
            archived = self._archived_agents.pop(agent_id, None)
            if archived is not None:
                self._agents[agent_id] = archived
                context = archived
        if context is None:
            context = self._find_by_name_or_avatar(agent_id)
            if context is not None:
                aid = context.agent_id
                if aid in self._archived_agents:
                    self._archived_agents.pop(aid, None)
                if aid not in self._agents:
                    self._agents[aid] = context
                agent_id = aid
        restored = False
        restore_error = ""
        if context is None and dispatch_mailbox_enabled():
            # Cross-restart path: the worker exists only in the persisted run store.
            context, restore_error = self._restore_dispatch_context(agent_id)
            if context is not None:
                agent_id = context.agent_id
                self._agents[agent_id] = context
                restored = True
        if context is None:
            if restore_error and restore_error != "not_found":
                return {
                    "ok": False,
                    "error": restore_error,
                    "message": _DISPATCH_ERRORS.get(restore_error, f"无法唤醒子智能体: {agent_id}"),
                }
            _log.warning(
                "send_message_to_subagent: agent_id=%s not in _agents (keys=%s)",
                agent_id,
                list(self._agents.keys()),
            )
            return {"ok": False, "error": "not_found", "message": f"未找到子智能体: {agent_id}"}
        text = message.strip()
        if not text:
            return {"ok": False, "error": "empty_message", "message": "消息不能为空"}

        mail: Dict[str, Any] = {}
        mail_id = ""
        if context.dispatch_id:
            running_turn = context.status == SubAgentStatus.RUNNING
            mail_id = str(message_id or "").strip() or uuid.uuid4().hex
            try:
                accepted, mail = dispatch_store.claim_mail(
                    self._run_store,
                    context.agent_id,
                    dispatch_id=context.dispatch_id,
                    message_id=mail_id,
                    text=text,
                    consumed_by="running_turn" if running_turn else "wake_turn",
                )
            except Exception as exc:  # noqa: BLE001
                _log.warning("[dispatch] mail claim failed for %s: %s", context.agent_id, exc)
                return {"ok": False, "error": "mailbox_unavailable", "message": "邮件未能持久化，未执行"}
            if not accepted:
                return {
                    "ok": True,
                    "duplicate": True,
                    "agent_id": context.agent_id,
                    "dispatch_id": context.dispatch_id,
                    "message_id": mail_id,
                    "status": context.status.value,
                    "consumed_at": mail.get("consumed_at"),
                }
            if not running_turn:
                dispatch_store.set_dispatch_state(
                    self._run_store, context.agent_id, dispatch_store.DISPATCH_STATE_RUNNING
                )

        if context.status == SubAgentStatus.RUNNING:
            session = self._agent_sessions.get(agent_id)
            if session is None:
                _log.warning("send_message: agent %s is RUNNING but session missing, rebuilding", agent_id)
                session = self._rebuild_agent_session(context)
            session.agent_messages.append({"role": "user", "content": text})
            session.chat_history.append({"role": "user", "content": text})
        else:
            _log.info("send_message: resuming agent %s (was %s, mode=%s)", agent_id, context.status.value, context.mode)
            self._ensure_agent_session(context)
            context.status = SubAgentStatus.RUNNING
            context.error_text = ""
            allowed_tools = self._build_toolset(context.allowed_tool_names)
            task = asyncio.create_task(
                self._run_subagent(
                    context,
                    allowed_tools=allowed_tools,
                    resume_input=text,
                    wake_mail=mail,
                )
            )
            self._tasks[agent_id] = task

        context.updated_at = time.time()
        try:
            self._run_store.update_status(agent_id, status=context.status.value)
            self._run_store.append_activity(
                agent_id,
                event_type="note",
                title="收到追问",
                detail=text,
                ts=context.updated_at,
            )
        except Exception as exc:  # noqa: BLE001
            _log.warning("[subagent_runs] follow-up update failed for %s: %s", agent_id, exc)
        await self._emit(
            RuntimeEvent(
                type=EventType.SUBAGENT_PROGRESS.value,
                data={"agent_id": agent_id, "text": f"收到用户追问: {text}"},
                agent_id=agent_id,
            )
        )
        result: Dict[str, Any] = {"ok": True, "agent_id": agent_id, "status": context.status.value}
        if context.dispatch_id:
            result["dispatch_id"] = context.dispatch_id
            result["message_id"] = mail_id
        if restored:
            result["restored"] = True
        return result
```

与旧函数的差异只有四处：签名多了仅关键字的 `message_id`；内存找不到时多一次磁盘回落；`empty_message` 之后多一段邮件认领；唤醒分支给 `_run_subagent` 多传 `wake_mail`；返回值多了三个可选键。其余逐字不变。

**(c) 新方法 `_restore_dispatch_context`**：在 Task 2 插入的 `_dispatch_suspend` 之后、`async def _run_subagent(` 之前插入：

```python
    def _restore_dispatch_context(self, query: str) -> tuple[Optional[SubAgentContext], str]:
        """Rebuild a worker context from its persisted dispatch after a restart.

        Returns ``(context, "")`` on success, else ``(None, error_code)``.
        """
        try:
            record, _match = dispatch_store.find_dispatch(self._run_store, query)
        except Exception as exc:  # noqa: BLE001
            _log.warning("[dispatch] lookup failed for %s: %s", query, exc)
            return None, "not_found"
        if record is None:
            return None, "not_found"
        dispatch = dispatch_store.dispatch_of(record)
        if not dispatch.get("dispatch_id"):
            return None, "dispatch_not_registered"
        if (
            dispatch.get("state") == dispatch_store.DISPATCH_STATE_CLOSED
            or record.status == SubAgentStatus.CANCELLED.value
        ):
            return None, "dispatch_closed"
        snapshot = dispatch_store.read_context_snapshot(self._run_store, record.run_id)
        if snapshot is None:
            return None, "context_unavailable"
        try:
            messages = [dict(row) for row in (snapshot.get("agent_messages") or []) if isinstance(row, dict)]
            artifacts = {Path(str(key)): str(value) for key, value in (snapshot.get("artifacts") or {}).items()}
            context = SubAgentContext(
                agent_id=record.run_id,
                name=record.name,
                role=record.role or "worker",
                task=record.task,
                source_tool_call_id=record.source_tool_call_id or "",
                status=_status_from_persisted(record.status),
                parent_agent_id=str(dispatch.get("parent_agent_id") or "meta"),
                depth=int(dispatch.get("depth") or 1),
                mode=str(dispatch.get("mode") or "run"),
                cleanup=str(dispatch.get("cleanup") or "keep"),
                run_timeout_seconds=(
                    int(dispatch["run_timeout_seconds"])
                    if dispatch.get("run_timeout_seconds") is not None
                    else 600
                ),
                attachments={
                    str(key): str(value) for key, value in (snapshot.get("attachments") or {}).items()
                },
                allowed_tool_names=[str(name) for name in (snapshot.get("allowed_tool_names") or [])],
                spawn_tree_path=str(dispatch.get("spawn_tree_path") or ""),
                provider_name=str(record.provider or ""),
                model_name=str(record.model or ""),
                output_files=list(record.output_files or []),
                workspace_dir=str(dispatch.get("workspace_dir") or ""),
                persona_prompt=str(record.persona or ""),
                avatar_id=str(record.avatar_id or ""),
                inherit_parent_context=bool(dispatch.get("inherit_parent_context", True)),
                failure_count=int(snapshot.get("failure_count") or 0),
                escalation_level=int(snapshot.get("escalation_level") or 0),
                result_file=str(record.result_file or ""),
                pause_detector=str(snapshot.get("pause_detector") or ""),
                pause_retryable=bool(snapshot.get("pause_retryable")),
                cluster_id=record.cluster_id,
                badge_seq=record.badge_seq,
                dispatch_id=str(dispatch.get("dispatch_id") or ""),
            )
            context.agent_messages = messages
            context.artifacts = artifacts
            context.context_files = {
                str(key): str(value) for key, value in (snapshot.get("context_files") or {}).items()
            }
            context.final_text = str(snapshot.get("final_text") or "")
            context.result_summary = str(record.result_summary or "")
            context.error_text = str(record.error_text or "")
            context.created_at = float(record.created_at or time.time())
            context.updated_at = float(record.updated_at or time.time())
        except Exception as exc:  # noqa: BLE001
            _log.warning("[dispatch] context rebuild failed for %s: %s", record.run_id, exc)
            return None, "context_unavailable"
        return context, ""
```

**(d) `_run_subagent` 签名**：把

```python
    async def _run_subagent(
        self,
        context: SubAgentContext,
        *,
        allowed_tools: Sequence[Dict[str, Any]],
        resume_input: Optional[str] = None,
    ) -> None:
```

替换为：

```python
    async def _run_subagent(
        self,
        context: SubAgentContext,
        *,
        allowed_tools: Sequence[Dict[str, Any]],
        resume_input: Optional[str] = None,
        wake_mail: Optional[Dict[str, Any]] = None,
    ) -> None:
```

函数体在本任务内不变（`wake_mail` 在 Task 4 才被使用）。返回类型沿用文件里既有的小写 `tuple[...]` 写法（如 `:783` 的 `_resolve_subagent_context`）；`:19` 的 typing 导入没有 `Tuple`，不要新增。

#### 3.3 实现：`agenticx/runtime/meta_tools.py`

**(a)** 在 `:2784` 与 `:2785`（`async def dispatch_meta_tool_async(`）之间插入：

```python
def _mail_message_id(arguments: Dict[str, Any]) -> str:
    """Return the caller's idempotency key, else the tool call id, else empty."""
    explicit = str(arguments.get("message_id", "") or "").strip()
    if explicit:
        return explicit
    call_id = str(arguments.get("__tool_call_id", "") or "").strip()
    return f"call:{call_id}" if call_id else ""


```

**(b)** 把 `:2898-2909` 的 `send_message_to_agent` 分支中的

```python
        result = await team_manager.send_message_to_subagent(agent_key, msg)
```

替换为：

```python
        result = await team_manager.send_message_to_subagent(
            agent_key,
            msg,
            message_id=_mail_message_id(arguments),
        )
```

**(c)** 把 `:395-413`（`send_message_to_agent` 的整段 schema）替换为：

```python
    {
        "type": "function",
        "function": {
            "name": "send_message_to_agent",
            "description": (
                "Send a follow-up instruction to a running or completed sub-agent or delegation "
                "(sa-* or dlg-*), or to a dispatch (dsp-*). "
                "Use the agent_id returned by spawn_subagent or delegate_to_avatar."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "agent_id": {
                        "type": "string",
                        "description": "Sub-agent ID (sa-*), dispatch ID (dsp-*), or delegation ID (dlg-*).",
                    },
                    "message": {"type": "string", "description": "Follow-up instruction for the agent."},
                    "message_id": {
                        "type": "string",
                        "description": (
                            "Optional idempotency key of this mail. Re-sending the same message_id to "
                            "the same sub-agent is a no-op; omit it to derive the key from this tool call."
                        ),
                    },
                },
                "required": ["agent_id", "message"],
                "additionalProperties": False,
            },
        },
    },
```

#### 3.4 依赖的现有 API

| API | 出处 | 依赖的行为 |
| --- | --- | --- |
| `send_message_to_subagent(agent_id, message)` 的现有查找顺序与两个分支 | `team_manager.py:679-748` | 内存路径逐字保留 |
| `_find_by_name_or_avatar(query)` | `team_manager.py:970-978` | 进程内别名查找 |
| `_ensure_agent_session`、`_rebuild_agent_session`、`_seed_session_history` | `team_manager.py:750-781` | 从 `context.agent_messages` 装配新会话 |
| `_build_toolset(allowed_names)` | `team_manager.py:447-452` | 传空列表得到全量工具集 |
| `SubAgentStatus.RUNNING` / `.PAUSED` / `.CANCELLED`、`str, Enum` 按值构造 | `team_manager.py:85-91` | `SubAgentStatus("paused")` 合法；非法值抛 `ValueError` |
| `RunRecord.run_id/name/role/task/source_tool_call_id/status/provider/model/avatar_id/persona/output_files/result_file/result_summary/error_text/created_at/updated_at/cluster_id/badge_seq` | `contracts.py:81-108` | 还原上下文的字段来源 |
| `agent_runtime` 把 `__tool_call_id` 并入 `dispatch_arguments` | `agent_runtime.py:3444`；`meta_tools.py:2869` | meta 工具参数里带有本次调用的 id |
| `dispatch_meta_tool_async` 的 `send_message_to_agent` 分支 | `meta_tools.py:2898-2909` | `dlg-` 前缀先行分流 |
| `AgentRuntime.run_turn` 把 user 行写进 `session.agent_messages` | `agent_runtime.py:4563-4573` | 唤醒邮件进入 worker 上下文 |

#### 3.5 验证

```bash
/opt/miniconda3/bin/python3 -m pytest tests/test_dispatch_wake_after_restart.py tests/test_subagent_dispatch_lifecycle.py tests/test_subagent_dispatch_mailbox.py -q --no-cov
/opt/miniconda3/bin/python3 -m pytest tests/test_team_manager.py tests/test_meta_tools.py tests/test_enhanced_spawn.py tests/test_work_item_runtime.py tests/test_smoke_subagent_run_store.py tests/test_subagent_run_resolver.py tests/test_smoke_subagent_completion.py tests/test_smoke_cc_stability_m5.py tests/test_meta_group_tools.py -q --no-cov
```

预期：第一行全部通过；第二行与实施前一致（`tests/test_enhanced_spawn.py`、`tests/test_smoke_cc_stability_m5.py` 覆盖进程内 `send_message_to_subagent` 的两条既有行为）。

### Task 4：唤醒事件走账本（recorder 接线、企业 Trace 开关、会话删除清理）

**目的**：邮件唤醒的回合在 Replay Ledger 里成为一个独立 run，落在 worker 自己的命名空间里；会话删除时一并清理。**主会话已定案（2026-11-28）：D-6b 取方案 (1)**——给 `ReplayLedgerRecorder` 加 `enterprise_trace` 开关、唤醒回合传 `False`；(b) 的改动与两个 Trace 测试保留。**D-13 已定案为「加规则」**，见新增的 (d)。

#### 4.1 先写失败的测试

新建 `tests/test_dispatch_wake_ledger.py`（完整内容）：

```python
"""Ledger tests for sub-agent wake-up turns.

Plan-Id: 2026-11-27-runtime-invariants-03-dispatch-mailbox

Author: Damon Li
"""

from __future__ import annotations

import asyncio
from typing import Any, List

import pytest

import agenticx.runtime.replay_ledger.recorder as recorder_module
from agenticx.cli.studio import StudioSession
from agenticx.runtime.replay_ledger.resume_anchor import find_open_run
from agenticx.runtime.replay_ledger.store import ReplayLedgerStore
from agenticx.runtime.subagent_runs import SubAgentRunStore
from agenticx.runtime.subagent_runs import dispatch as dispatch_store
from agenticx.runtime.team_manager import AgentTeamManager

OWNER = "sess-dispatch-ledger"
MAIL = "continue: write the second note"


class _FakeResponse:
    def __init__(self, content: str, tool_calls: List[Any]) -> None:
        self.content = content
        self.tool_calls = tool_calls


class _QuickTextLLM:
    def invoke(self, *_args: Any, **_kwargs: Any) -> _FakeResponse:
        return _FakeResponse("done", [])

    def stream(self, *_args: Any, **_kwargs: Any):
        yield "ok"


async def _wait_until(predicate, timeout: float = 5.0) -> None:
    started = asyncio.get_running_loop().time()
    while not predicate():
        await asyncio.sleep(0.02)
        if (asyncio.get_running_loop().time() - started) > timeout:
            raise TimeoutError("condition not met in time")


def _new_manager() -> AgentTeamManager:
    """A fresh manager for the same owner session, i.e. a backend restart."""
    return AgentTeamManager(
        llm_factory=lambda: _QuickTextLLM(),
        base_session=StudioSession(),
        owner_session_id=OWNER,
    )


def _dispatch(run_id: str) -> dict:
    record = SubAgentRunStore(OWNER).get_run(run_id)
    assert record is not None
    return dispatch_store.dispatch_of(record)


def _waiting(run_id: str) -> bool:
    return _dispatch(run_id).get("state") == dispatch_store.DISPATCH_STATE_WAITING


async def _spawn_and_settle(manager: AgentTeamManager) -> str:
    spawned = await manager.spawn_subagent(name="worker-a", role="worker", task="write a short note")
    assert spawned["ok"] is True
    run_id = spawned["agent_id"]
    await _wait_until(lambda: _waiting(run_id))
    return run_id


def _ledger() -> ReplayLedgerStore:
    return ReplayLedgerStore(dispatch_store.ledger_root_for(SubAgentRunStore(OWNER)))


def test_wake_turn_is_recorded_in_an_isolated_ledger_namespace(tmp_path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("HOME", str(tmp_path))

    async def _run() -> None:
        run_id = await _spawn_and_settle(_new_manager())
        ledger = _ledger()
        namespace = dispatch_store.dispatch_ledger_session_id(OWNER, run_id)

        # The spawn turn is not recorded.
        assert ledger.list_runs(namespace) == []

        woken = await _new_manager().send_message_to_subagent(run_id, MAIL, message_id="mail-1")
        assert woken["ok"] is True
        await _wait_until(lambda: _waiting(run_id))

        runs = ledger.list_runs(namespace)
        assert len(runs) == 1
        assert runs[0].agent_id == run_id
        assert runs[0].status == "completed"
        assert ledger.get_run(runs[0].run_id) is not None

        # The owner session's ledger is untouched: no pollution, no shadowing.
        assert ledger.list_runs(OWNER) == []
        assert find_open_run(ledger, OWNER) is None

        third = _new_manager()
        again = await third.send_message_to_subagent(run_id, "third note", message_id="mail-2")
        assert again["ok"] is True
        await _wait_until(lambda: len(ledger.list_runs(namespace)) == 2 and _waiting(run_id))

    asyncio.run(_run())


def test_wake_run_is_not_enqueued_for_enterprise_trace(tmp_path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("HOME", str(tmp_path))
    enqueued: List[str] = []
    monkeypatch.setattr(
        recorder_module,
        "enqueue_completed_run",
        lambda store, run_id: enqueued.append(run_id),
    )

    async def _run() -> None:
        run_id = await _spawn_and_settle(_new_manager())
        woken = await _new_manager().send_message_to_subagent(run_id, MAIL, message_id="mail-1")
        assert woken["ok"] is True
        namespace = dispatch_store.dispatch_ledger_session_id(OWNER, run_id)
        await _wait_until(lambda: len(_ledger().list_runs(namespace)) == 1 and _waiting(run_id))
        assert enqueued == []

    asyncio.run(_run())


def test_recorder_enterprise_trace_switch_controls_enqueue(tmp_path, monkeypatch: pytest.MonkeyPatch) -> None:
    enqueued: List[str] = []
    monkeypatch.setattr(
        recorder_module,
        "enqueue_completed_run",
        lambda store, run_id: enqueued.append(run_id),
    )
    store = ReplayLedgerStore(tmp_path)

    def _finish(enabled: bool) -> str:
        recorder = recorder_module.ReplayLedgerRecorder(
            store=store,
            session_id="sess-recorder",
            agent_id="meta",
            provider=None,
            model=None,
            enterprise_trace=enabled,
        )
        recorder.start_turn(turn_id="turn-1", user_input="hi", session=StudioSession())
        run_id = str(recorder.current_run_id)
        recorder.finish("completed")
        return run_id

    assert _finish(False) != ""
    assert enqueued == []
    assert _finish(True) != ""
    assert len(enqueued) == 1
```

#### 4.2 实现

**(a) `agenticx/runtime/team_manager.py`**

把 `_run_subagent` 里的 `AgentRuntime(` 构造（Task 2 / 3 之后行号已偏移；以 `runtime = AgentRuntime(` 开头、以 `clarify_gate=context.clarify_gate,` 后的 `)` 结束的九行）：

```python
        runtime = AgentRuntime(
            llm,
            context.confirm_gate,
            max_tool_rounds=_resolve_max_tool_rounds(),
            loop_warning_threshold=8,
            loop_critical_threshold=16,
            team_manager=self,
            clarify_gate=context.clarify_gate,
        )
```

替换为：

```python
        runtime = AgentRuntime(
            llm,
            context.confirm_gate,
            max_tool_rounds=_resolve_max_tool_rounds(),
            loop_warning_threshold=8,
            loop_critical_threshold=16,
            team_manager=self,
            clarify_gate=context.clarify_gate,
            run_recorder=(
                self._build_wake_recorder(context, resolved_provider, resolved_model)
                if wake_mail is not None
                else None
            ),
        )
```

在 Task 3 插入的 `_restore_dispatch_context` 之后、`async def _run_subagent(` 之前插入：

```python
    def _build_wake_recorder(
        self,
        context: SubAgentContext,
        provider: Optional[str],
        model: Optional[str],
    ) -> Optional[Any]:
        """Build the ledger recorder of one wake-up turn, isolated in the worker's namespace."""
        if not context.dispatch_id or not self.owner_session_id:
            return None
        try:
            from agenticx.runtime.replay_ledger.contracts import validate_ledger_id
            from agenticx.runtime.replay_ledger.recorder import ReplayLedgerRecorder
            from agenticx.runtime.replay_ledger.store import ReplayLedgerStore

            sessions_root = dispatch_store.ledger_root_for(self._run_store)
            if sessions_root is None:
                return None
            session_id = validate_ledger_id(
                dispatch_store.dispatch_ledger_session_id(self.owner_session_id, context.agent_id),
                "session_id",
            )
            return ReplayLedgerRecorder(
                store=ReplayLedgerStore(sessions_root),
                session_id=session_id,
                agent_id=context.agent_id,
                provider=str(provider or "").strip() or None,
                model=str(model or "").strip() or None,
                enterprise_trace=False,
            )
        except Exception as exc:  # noqa: BLE001
            _log.warning("[dispatch] wake ledger recorder unavailable for %s: %s", context.agent_id, exc)
            return None
```

recorder 构造失败时返回 `None`，回合照常执行、只是不记账本（与 `recorder_for_session` 的降级方式一致，`recorder.py:628-630`）。

**(b) `agenticx/runtime/replay_ledger/recorder.py`**（取决于 D-6b）

把 `:66-67`：

```python
        resume_run_id: str | None = None,
        branch_lineage: dict[str, Any] | None = None,
    ) -> None:
```

替换为：

```python
        resume_run_id: str | None = None,
        branch_lineage: dict[str, Any] | None = None,
        enterprise_trace: bool = True,
    ) -> None:
```

在 `:75`（`self.branch_lineage = dict(branch_lineage or {})`）之后插入：

```python
        self.enterprise_trace = bool(enterprise_trace)
```

把 `:590-595`：

```python
            run_id = self.current_run_id
            if run_id is not None:
                try:
                    enqueue_completed_run(self.store, run_id)
                except Exception:
                    logger.debug("enterprise trace enqueue failed", exc_info=True)
```

替换为：

```python
            run_id = self.current_run_id
            if run_id is not None and self.enterprise_trace:
                try:
                    enqueue_completed_run(self.store, run_id)
                except Exception:
                    logger.debug("enterprise trace enqueue failed", exc_info=True)
```

缺省值 `True` 使 01 的所有既有调用方行为不变。

**(c) `agenticx/studio/session_manager.py`**

在 `:1379`（`_log.warning("replay ledger cleanup failed session=%s", sid, exc_info=True)`）与 `:1380`（`purged = self._purge_session_state(sid)`）之间插入：

```python
        try:
            from agenticx.runtime.subagent_runs.dispatch import delete_dispatch_ledger_runs

            delete_dispatch_ledger_runs(sid, sessions_root=Path(self._sessions_root))
        except Exception:
            _log.warning("dispatch ledger cleanup failed session=%s", sid, exc_info=True)
```

必须排在 `_purge_session_state` 之前：清理函数要读的 run 记录在 `subagent_runs/` 下，而那一步会删掉整个会话目录。

**(d) `scripts/ci/ratchet-baseline.json`（主会话定案 D-13 追加的任务）**：把文件末尾的

```json
    {
      "id": "resume-anchor-bypass",
      "description": "The ledger-projected resume anchor is entered only through load_resume_anchor, which keeps recovery layering (HA mode reads the checkpoint store) and the AGX_RESUME_FROM_LEDGER switch. A direct project_resume_anchor( call elsewhere skips both.",
      "exclude": ["agenticx/runtime/replay_ledger/", "agenticx/runtime/checkpoint.py"],
      "patterns": ["project_resume_anchor("],
      "baseline": 0
    }
  ]
}
```

替换为：

```json
    {
      "id": "resume-anchor-bypass",
      "description": "The ledger-projected resume anchor is entered only through load_resume_anchor, which keeps recovery layering (HA mode reads the checkpoint store) and the AGX_RESUME_FROM_LEDGER switch. A direct project_resume_anchor( call elsewhere skips both.",
      "exclude": ["agenticx/runtime/replay_ledger/", "agenticx/runtime/checkpoint.py"],
      "patterns": ["project_resume_anchor("],
      "baseline": 0
    },
    {
      "id": "dispatch-mailbox-bypass",
      "description": "Dispatch mailbox and context snapshot files are read and written only through agenticx/runtime/subagent_runs/, which owns the per-root lock and the atomic writer. Lines elsewhere that open *.mailbox.json or *.context.json by path bypass that API. Baseline 0: no such literals exist outside the package at review time.",
      "exclude": ["agenticx/runtime/subagent_runs/"],
      "patterns": [".mailbox.json", ".context.json"],
      "baseline": 0
    }
  ]
}
```

规则是数据驱动的（`ratchet.py` 按字典校验 `id` / `description` / `exclude` / `patterns` / `baseline` 五键），无需改 `ratchet.py`；`tests/test_ci_ratchet.py::test_repository_baseline_keeps_the_startup_rules` 用的是子集断言，追加规则不破坏它。

#### 4.3 依赖的现有 API

| API | 出处 | 依赖的行为 |
| --- | --- | --- |
| `AgentRuntime(llm, confirm_gate, *, …, team_manager, clarify_gate, run_recorder=None)` | `agent_runtime.py:3605`、`:3614` | `run_recorder` 缺省 `None`；传 `None` 与不传等价 |
| `run_turn` 对 recorder 的调用 | `agent_runtime.py:4135`（`start_turn`）、`:4187`（`observe`）、`:4200-4206`（`finish`） | 每个回合开一个 run、结束关闭 |
| `ReplayLedgerRecorder(*, store, session_id, agent_id, provider, model, resume_run_id=None, branch_lineage=None)` | `recorder.py:58-68` | 关键字构造 |
| `ReplayLedgerRecorder.start_turn(*, turn_id, user_input, history_metadata=None, session=None) -> str`；`.current_run_id` | `recorder.py:89-96`、`:177` | `current_run_id` 在 `start_turn` 后可用 |
| `ReplayLedgerRecorder.finish` 调 `enqueue_completed_run(self.store, run_id)` | `recorder.py:579-598`；导入在 `:17` | 模块级名字，monkeypatch 可替换 |
| `validate_ledger_id(value, field_name)` | `replay_ledger/contracts.py:54-63` | 非法 id 抛 `ValueError` |
| `capture_git_workspace_snapshot` 的 isolate 短路 | `workspace_snapshot.py:147-149`；ref 写入 `:201-209`；清理 `:248-276` | 非 isolate 工作区不产生 git 子进程与 ref |
| `SessionManager.delete` | `session_manager.py:1364-1383` | `Path`、`_log`、`self._sessions_root`（`:674`）均在作用域内 |
| `ReplayRunRecord.agent_id` / `.status` / `.run_id` | `replay_ledger/contracts.py:75-88` | 列表断言 |

#### 4.4 验证

```bash
/opt/miniconda3/bin/python3 -m pytest tests/test_dispatch_wake_ledger.py tests/test_dispatch_wake_after_restart.py tests/test_subagent_dispatch_lifecycle.py tests/test_subagent_dispatch_mailbox.py -q --no-cov
/opt/miniconda3/bin/python3 -m pytest tests/test_replay_ledger_recorder.py -q --no-cov
/opt/miniconda3/bin/python3 -m pytest tests/test_smoke_subagent_run_store.py tests/test_subagent_run_resolver.py -q --no-cov
```

预期：第一行全部通过；第二行（含 `tests/test_replay_ledger_recorder.py:385` 的 `test_subagent_runtime_events_do_not_consume_parent_ledger_sequence`）与第三行与实施前一致。

### 未经执行验证的假设清单

以下各点规划阶段无法执行验证，需主会话静态复核或实施者在写实现前先跑一遍对应的探针：

1. **真实 `AgentRuntime` 配假 LLM 时，一个正常结束的回合让 recorder 的 run 落为 `completed`。** 依据是 `agent_runtime.py:4200` 的 `recorder.finish("completed")`，但该分支的进入条件未逐行核实。若落成别的状态，只影响 `tests/test_dispatch_wake_ledger.py::test_wake_turn_is_recorded_in_an_isolated_ledger_namespace` 里的一条断言。
2. **唤醒回合的模型输入包含上一回合的 assistant 文本 `first-answer`。** 断言依赖 runtime 把 `session.agent_messages` 原样放进模型输入；若 runtime 对历史做了脱敏或改写，子串可能变化。断言已用子串匹配，未做整行比较。
3. **`_resolve_bool` 没有缓存。** 同一测试进程内先 `delenv` 再 `setenv` 需要立即生效（`harden_flags.py:57-64` 未见缓存，`_config_bool` 内部未读）。
4. **`monkeypatch.setenv("HOME")` 对 `Path.home()` 生效。** 现有测试（`tests/test_smoke_subagent_run_store.py:150`）依赖同一事实。
5. **runtime 在一个回合里至少调用一次假 LLM，且不会在回合之外调用。** 「只执行一次」的断言比较的是调用次数的差值。
6. **新增的模块级 import 不构成循环导入**：`team_manager.py` → `subagent_runs.dispatch`、`harden_flags`；`dispatch.py` → `subagent_runs.store` / `contracts`（`replay_ledger` 只在函数体内 import）。需冷启动冒烟确认。
7. **`open_run` 对已存在记录的 `detail_refs` 处理不影响本 plan。** `close_run` 的按键合并已读到（`store.py:331-334`，跳过 `None` 值），不会抹掉 `dispatch` 键；但 `open_run` 的 `detail_refs=dict(detail_refs or old_record.detail_refs if old_record else detail_refs or {})`（`store.py:138`）在记录已存在时会用新传入的整体替换——本 plan 只在全新 spawn 时调 `open_run`，不会走到这个分支。
8. **`os.replace` 到一个被空目录占用的路径会抛异常**，且 `_write_json` 重新抛出（`store.py:681-683` 已读到）。fail-closed 测试依赖这一点。
9. **`query_subagent_status` 的工具输出包含 `_serialize_status` 的行**，所以 `dispatch_id in raw` 成立。
10. **`cancel_subagent` 能在 `_agents` 里找到已完成、`mode == "run"` 的 worker**（`team_manager.py:1553-1554` 只在 `cleanup == "delete"` 时移除）。
11. **`tests/test_meta_tools.py` 等既有测试里没有带 `send_message_to_subagent` 方法的假 team manager。** 若有，新加的仅关键字参数 `message_id` 会让它抛 `TypeError`。grep 显示 tests 目录只有 `tests/test_enhanced_spawn.py`、`tests/test_smoke_cc_stability_m5.py` 直接调用该方法，且都作用于真实 `AgentTeamManager`。
12. **没有既有测试对 `_serialize_status` 的返回做整字典相等断言。** 新增的 `dispatch_id` 键会让这类断言失败。
13. **`sessions_root` 下多出一个兄弟目录 `<owner>:dispatch:<agent_id>` 不会被任何代码当成会话。** `_sessions_root.*(iterdir|glob|listdir|scandir)` 零命中；其它模块对 `Path(sessions_root)` 的用法未逐一核实。
14. **isolate 工作区下唤醒回合会在用户仓库里写快照 ref**（`workspace_snapshot.py:201-206`），并随 D-7 的清理被删除。单元测试不覆盖 isolate 路径。
15. **`SessionManager.delete` 的清理接线没有自动化测试**（构造 `SessionManager` 的夹具较重，未核实是否有轻量写法）。由 `delete_dispatch_ledger_runs` 的单元测试加冷启动冒烟覆盖。

## 实施后评审处置（2026-11-28）

实施由 sub agent 一次完成四个任务（TDD），主会话独立复跑全部验证并另派独立评审员。逐条处置：

| # | 来源 | 问题 | 处置 |
| --- | --- | --- | --- |
| 1 | 实施红灯 | plan 内部矛盾：`_restore_dispatch_context` 对未知地址返回 `not_found`，实现块让它走 `_DISPATCH_ERRORS` 缺省文案「无法唤醒子智能体」，而测试断言 AC-6 的旧文案「未找到子智能体」 | **修实现侧**：`not_found` 回落旧分支（`restore_error != "not_found"`），保持旧返回逐字不变；代码与 plan 同步修订，26 个新测试全绿 |
| 2 | 独立评审 | `set_dispatch_state` 的读-改-写中 `get_run` 在锁外，并发 wake/cancel 可能丢一次状态写入 | **采纳**：整体包进 `store.locked()`（RLock 可重入，`merge_detail_refs` 在同锁内安全）；代码与 plan 同步修订 |
| 3 | 独立评审 | `run_timeout_seconds=0`（不限时）经 dispatch 记录往返后变成 600（`int(x or 600)`） | **采纳**：`build_dispatch_detail` 忠实存 0、`_restore_dispatch_context` 仅在键缺失时缺省 600；代码与 plan 同步修订 |
| 4 | 独立评审 | `read_aux_json` 把损坏 JSON 静默当空邮箱，理论上旧认领会丢失（幂等失效） | **不修，记为已接受风险**：原子写（mkstemp+replace）使该窗口仅剩磁盘级损坏；「至多一次」契约已声明此类丢失窗口。后续可加 warning 日志 |
| 5 | 独立评审 | `_serialize_status` 无条件多出 `dispatch_id` 键，开关关闭时状态行形状也有加法变更 | **接受**：属既定设计（状态行暴露 dispatch_id 供寻址），已核实无消费方做整字典相等断言 |
| 6 | 独立评审 | 其余核实项（认领原子性与 fail-closed、开关关闭逐字等价、`message_id` 对 HTTP 调用方向后兼容、`_safe_name` 无路径穿越、recorder 异常路径收口、命名空间不被 FTS backfill / 会话列举 / 企业 trace 误认、删除清理次序） | 全部确认无问题 |

评审结论：可合入。基线失败 `tests/test_meta_tools.py::test_meta_tools_list_skills_and_mcps`（本机全局 MCP 配置所致）与本改动无关，保持原样。

## 交付约定

- 实施者只改本 plan「Precise landing points」列出的文件，不提交、不推送、不改测试断言。实现与 plan 一致但测试仍失败时停下报告。
- 主会话独立复跑 `## Verification` 的全部命令，审 diff，用脚本把新文件与被替换的代码块同 plan 逐字比对。
- 验收后：plan 从 `.cursor/plans/pending/` 移到 `.cursor/plans/`，`Status` 改为 `implemented`；只 `git add` plan 内列出的文件；提交一个 commit。
- 规划阶段未执行任何命令（环境限制），基线数字待实施开始时补测：实施前先跑一遍 `## Verification` 的回归命令并记录结果，再开始 Task 1。

## Suggested impl models

- 实施：GLM-5.4（与 01、02 一致）。
- 不建议拆并行子 agent：四个任务串行依赖，且 Task 2 / 3 / 4 都改 `agenticx/runtime/team_manager.py` 的相邻区域。

## Verification

以下命令**在规划阶段均未执行（环境限制）**；实施时逐条执行并记录输出。基线数字待实施开始时补测。

**判据对应表：**

| 判据 | 自动化验证（测试文件::用例名） | 断言落点 |
| --- | --- | --- |
| AC-1 显式挂起态持久 | `tests/test_subagent_dispatch_lifecycle.py::test_turn_end_persists_waiting_state_and_context_snapshot` | `record.status == "completed"`；`dispatch["state"] == "waiting"`；快照存在且含任务与回复 |
| AC-2 重启后找得回 | `tests/test_dispatch_wake_after_restart.py::test_addressing_by_dispatch_id_and_name_after_restart` | 按 `dsp-*` 与名称都能 `ok`，且 `agent_id == run_id` |
| AC-3 上下文续得上 | `tests/test_dispatch_wake_after_restart.py::test_waiting_worker_is_woken_once_after_restart_with_context` | `any("first-answer" in seen for seen in llm.seen[calls_before:])`；新快照含邮件的 user 行；行数增加 |
| AC-4 只执行一次 | 同上；`tests/test_dispatch_wake_after_restart.py::test_send_message_tool_derives_message_id_from_the_tool_call`；`tests/test_subagent_dispatch_mailbox.py::test_claim_mail_consumes_each_message_id_once`、`::test_claim_mail_survives_a_new_store_instance`、`::test_claim_mail_fails_closed_when_the_mailbox_cannot_be_written` | `llm.calls == calls_after_wake`；`duplicate is True`；`again is False` |
| AC-5 唤醒事件走账本 | `tests/test_dispatch_wake_ledger.py::test_wake_turn_is_recorded_in_an_isolated_ledger_namespace`；`tests/test_subagent_dispatch_mailbox.py::test_worker_ledger_namespace_never_shadows_the_owner_session` | `runs[0].agent_id == run_id`；`find_open_run(ledger, OWNER) is None`；`ledger.list_runs(OWNER) == []` |
| AC-6 旧行为不回归 | `tests/test_subagent_dispatch_lifecycle.py::test_switch_off_keeps_the_legacy_record_shape`；`tests/test_subagent_dispatch_mailbox.py::test_dispatch_mailbox_switch_defaults_on_and_reads_env`；下方的既有测试回归 | `dispatch_of(record) == {}`；`not_found` 的返回值逐字相等 |
| 取消即关闭 | `tests/test_subagent_dispatch_lifecycle.py::test_cancelled_worker_closes_its_dispatch`；`tests/test_dispatch_wake_after_restart.py::test_cancelled_worker_is_closed_after_restart` | `state == "closed"`；重启后 `error == "dispatch_closed"` |
| 无上下文即拒绝 | `tests/test_dispatch_wake_after_restart.py::test_stale_running_record_without_snapshot_is_refused`、`::test_legacy_record_without_dispatch_is_refused` | `llm.calls == 0` |
| 清理 | `tests/test_subagent_dispatch_mailbox.py::test_delete_dispatch_ledger_runs_removes_namespaced_runs` | `list_runs(namespace) == []` |

**命令：**

```bash
# 新增测试（四个文件）
/opt/miniconda3/bin/python3 -m pytest tests/test_subagent_dispatch_mailbox.py tests/test_subagent_dispatch_lifecycle.py tests/test_dispatch_wake_after_restart.py tests/test_dispatch_wake_ledger.py -q --no-cov

# master plan 基线第 3 条
/opt/miniconda3/bin/python3 -m pytest tests/test_smoke_subagent_run_store.py tests/test_subagent_run_resolver.py -q --no-cov

# 01 的账本测试（含 test_subagent_runtime_events_do_not_consume_parent_ledger_sequence）
/opt/miniconda3/bin/python3 -m pytest tests/test_replay_ledger_recorder.py -q --no-cov

# master plan 点名的相关既有测试
/opt/miniconda3/bin/python3 -m pytest tests/test_team_manager.py tests/test_meta_tools.py tests/test_enhanced_spawn.py tests/test_work_item_runtime.py tests/test_smoke_subagent_completion.py tests/test_smoke_cc_stability_m5.py tests/test_meta_group_tools.py -q --no-cov

# 门禁（02）
PYTHONPATH=/tmp/agx-ci-deps:"$PWD" /opt/miniconda3/bin/python3 scripts/ci/python-regressions.py
RATCHET_BASE_REF=HEAD /opt/miniconda3/bin/python3 scripts/ci/ratchet.py

# 冷启动冒烟（session_manager.py / team_manager.py / meta_tools.py 都在 server.py 的 import 链上）
.venv/bin/agx serve --host 127.0.0.1 --port 8769
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:8769/api/health   # 期望 200
```

**手工闭环（master plan 闭环第 3 条，可选，需真实模型）**：worker 等待中重启后端，协调者发一封邮件，worker 被唤醒、上下文续得上，且只执行一次。自动化等价物是 `tests/test_dispatch_wake_after_restart.py::test_waiting_worker_is_woken_once_after_restart_with_context`。

**ratchet 三条规则的自查**：新代码不含 `run_dir / "events.jsonl"`、`runs/*/events.jsonl` 字面量；不含 `save_agent_state(`、`project_resume_anchor(` 调用；不调大基线。

**可选的新 ratchet 规则（提议，由主会话定）**：`agenticx/runtime/subagent_runs/` 之外不得出现字面量 `.mailbox.json` 或 `.context.json`，防止旁路 `SubAgentRunStore` 的辅助文件 API。基线 0（阅读所见全仓没有这两个字面量）。**已定案：加，见 Task 4 (d)。**

## 风险与回滚

| 风险 | 说明 | 缓解 |
| --- | --- | --- |
| 快照体积 | 每个 worker 一份与上下文等大的 JSON（含 `artifacts` / `context_files` / `attachments` 的内容），每回合结束覆盖写 | 只在进入 `waiting` 时写；单个 worker 恰好一份；后续如需要再加体积上限 |
| 至多一次 | 认领落盘与回合结束之间崩溃会丢这封邮件（第 6 节） | 明确写入契约；发送方用新的 `message_id` 重发；不做自动重投 |
| 幂等窗口有界 | 邮箱只留最近 50 封 | 更早的邮件被淘汰后重投会被当作新邮件；这是有意的体积上限 |
| 同机多进程共用 `HOME` | 两个后端进程会看到同一份磁盘状态，可能对同一个 worker 各执行一次 | 与现有 `SubAgentRunStore` 的限制相同（进程内锁），不在 03 承诺内 |
| 命名空间目录 | `<sessions_root>/<owner>:dispatch:<agent_id>/` 是会话目录的兄弟目录 | 已核实 `list_runs` / `find_open_run` / `/api/runs` 扫不到；会话删除时显式清理；其它枚举代码未逐一核实（假设 13） |
| 企业 Trace 契约 | 唤醒回合若照常上传，邮件正文可能作为 `user_text` 进入 outbox | D-6b；推荐加开关并关闭 |
| 进程内 / 重启后的不对称 | 进程内被取消的 worker 可被邮件复活，重启后不可 | D-5b；本 plan 选择不动既有进程内行为 |
| on-disk 形状变化 | run 记录多出 `detail_refs.dispatch`，`subagent_runs/` 下多出两类文件 | 都是追加；`load_run_records` 按 index 读记录（`agenticx/ops/parity.py:86-108`），`load_confirm_pendings` 只 glob `*.activity.jsonl`（`:142-144`），不受影响 |
| 开关默认开 | 所有用户默认获得新行为与新文件 | `AGX_DISPATCH_MAILBOX=0` 立即回到旧行为（已写入的文件无害）；D-11 可改默认值 |

**回滚**：运行时回滚 = 设 `AGX_DISPATCH_MAILBOX=0`，`send_message_to_subagent` 回到 03 之前的逐字行为（磁盘回落、认领、快照、唤醒账本全部关闭；进程内唤醒本就未变）。代码回滚 = revert 这一个 commit；已写入的 `<run>.mailbox.json`、`<run>.context.json` 与命名空间账本目录留在盘上无害，随会话删除（旧代码不会删命名空间目录，需手工清理或忽略）。

## 已定案事项

### 规划时在授权范围内定的（主会话审查时可否决）

- **A-1** dispatch 记录放 run 记录的 `detail_refs["dispatch"]`，`RunRecord` 不加字段。
- **A-2** 挂起态是 dispatch 的 `state ∈ {running, waiting, closed}`；`SubAgentStatus` 不加枚举值。
- **A-3** 只记唤醒回合（spawn 回合与升级重试回合不记）；账本命名空间 `<owner_session_id>:dispatch:<agent_id>`，同一个 `sessions_root`。
- **A-4** `message_id` 的来源优先级：显式 `message_id` → `call:<__tool_call_id>` → 随机（不去重）。
- **A-5** 先持久化认领、后执行；语义是至多一次；重复投递返回 `{"ok": True, "duplicate": True, ...}`。
- **A-6** 上下文快照只在回合结束时写（进入 `waiting` 的同一时刻），不在回合中途写。
- **A-7** 重启后没有上下文快照就拒绝（`context_unavailable`），不以空上下文唤醒。
- **A-8** 一个开关 `AGX_DISPATCH_MAILBOX` / `runtime.dispatch_mailbox`，默认 `True`。
- **A-9** 03 不修 `_mark_subagent_runs_interrupted`。
- **A-10** `resolver.py` 与 `server.py` 不改。
- **A-11** 新增 4 个测试文件，不改既有测试文件。
- **A-12** `SessionManager.delete` 补一次命名空间账本清理，排在 `_purge_session_state` 之前。
- **A-13** 邮箱只留最近 50 封。

### 主会话定案（2026-11-28 审查时拍板）

- **D-6b 企业 Trace：取 (1)。** `ReplayLedgerRecorder` 加 `enterprise_trace: bool = True`，唤醒回合传 `False`；缺省 `True` 保证 01 的既有调用方零变化。邮件正文不进企业 outbox。
- **D-5b 进程内 / 重启后取消不对称：取 (1)，保持现状。** 03 的边界是跨重启唤醒，不改进程内既有行为。
- **D-8 `_mark_subagent_runs_interrupted` 空操作缺陷：取 (1)，本 plan 不修**，由主会话在 03 提交之后另开一个独立小 commit 修复（1 行改 `status="interrupted"` + 1 个测试，并核实 `interrupted` 在 `resolver.py:14-20` 两个集合与客户端的呈现）。缺陷本身已由主会话独立复核属实（`update_status` 的 `status` 是仅关键字参数，`TypeError` 被吞）。
- **D-11 开关默认值：`True`**，与 01/02 的开关口径一致；`AGX_DISPATCH_MAILBOX=0` 回到旧行为。
- **D-12 无快照时拒绝唤醒（`context_unavailable`）**，不以空上下文伪造续接。
- **D-13 新增 ratchet 规则：加**（Task 4 (d)）：`dispatch-mailbox-bypass`，`patterns` 为 `.mailbox.json` / `.context.json`，基线 0（主会话已 grep 复核 `agenticx/` 下零命中）。
- **D-14 账本数据模型：不动。** 唤醒回合的 `agent_id` 就是 worker id，足以支撑回放；payload 扩展等真有消费方再做。
- **D-15 `agent_messages` 中途持久化：不做。** 不属于本子 plan 的闭环判据。

## Commit trailers

提议的提交标题（英文，`type(scope): subject`）：

```
feat(runtime): persist dispatch mailbox and wake suspended sub-agents after restart
```

正文结构：`## What & Why`（三件原语 + 唤醒事件走账本；为什么是至多一次；为什么用独立命名空间）+ `## Requirements`（FR-1 持久 dispatch 记录；FR-2 显式挂起态；FR-3 上下文快照与重建；FR-4 `message_id` 幂等；FR-5 唤醒回合记入账本且不遮蔽父回合；FR-6 开关关闭回到旧行为；AC-1 … AC-6 同 `## Goal`）。

trailers：

```
Plan-Id: 2026-11-27-runtime-invariants-03-dispatch-mailbox
Plan-File: .cursor/plans/2026-11-27-runtime-invariants-03-dispatch-mailbox.plan.md
Plan-Model: GLM-5.4
Impl-Model: GLM-5.4
Made-with: Damon Li
```

