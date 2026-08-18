# 项目群多智能体协作闭环实施计划

Planned-with: gpt5.6sol

Suggested-Impl-Model: gpt5.6sol

## 1. 背景与根因证据

当前项目群已经具备“不同分身分别调用各自 `AgentRuntime`”的基础，但还没有形成可验收的团队协作闭环：

1. `agenticx/runtime/group_router.py::_run_team_turn` 只使用 `WorkforcePattern` 做任务分解和分配；每个图节点执行一次 `_run_one_target_stream` 后，只要有文本就立即发布 `TASK_COMPLETED`。
2. 当前节点执行器没有独立审核者、质量结论、P0/P1 门控或返工路径，执行结果未经验证便被视为完成。
3. `_run_one_target` 每次创建全新的 `StudioSession`。成员只能看到共享群聊的最近若干条文本，自己的工具执行上下文和跨轮任务上下文不会延续。
4. 图节点虽然支持 `dependencies`，但下游节点输入只包含自己的 `description`；上游节点的真实产出没有显式交接给下游。
5. 团队结束时仍使用“微信群短聊、默认勿写长报告”的总结提示，且没有把完整阶段结果显式传给负责人。任务较长时，早期成员产出还可能被最近消息窗口截断。
6. `routing="intelligent"` 只在现有多步骤关键词命中时进入团队路径；“大家讨论 / 交叉评审 / 共同分析”等明确协作意图并不稳定触发团队编排。

本地团队插件的共性机制可归纳为：负责人统一编排、成员独立首轮、显式交接、独立评审、失败返工、最终交付契约。本计划将这些机制映射到现有 `WorkforcePattern + GraphRun + AgentRuntime`，不引入第二套运行时。

## 2. 目标

- 项目群中的复杂任务和明确团队协作请求，真正由两个或更多独立分身参与。
- 每个任务产出必须经过另一位成员的结构化审核；未通过时自动返工，不得提前标记完成。
- 依赖任务拿到上游已审核结果，而不是只看到任务标题。
- 每个成员在同一群会话内保留独立、受限、可持久化的运行上下文。
- 负责人基于完整执行档案做最终收口，并生成可追溯的 Markdown 协作产物。
- 用户只看到有意义的成员产出、审核结论和返工结果；工具进度继续走现有折叠/状态通道，不增加过程广播刷屏。

## 3. 范围

### In scope

- `hc-0818` 的 Desktop 项目群运行时。
- `routing="team"` 及 `routing="intelligent"` 自动进入团队路径的执行闭环。
- 执行者/审核者选择、审核协议、返工上限、依赖产出交接、负责人终稿、群工作区产物。
- 群会话 scratchpad 内的成员独立文本上下文。
- GraphRun 节点元数据和 artifact 引用。

### Out of scope

- 不修改 `main`，不向 `main` 写 plan 或代码。
- 不重写通用 `WorkforcePattern`、Graph Scheduler 或 AgentRuntime。
- 不新增群编辑器中的“编排模式”配置项。
- 不新增后端 API 契约或数据库模型。
- 不把每个工具调用变成独立群消息。
- 不承诺审核模型能验证外部世界中无法访问的事实；工具不可用时必须在审核/终稿中显式保留风险。

## 4. 设计与精确落点

### 4.1 新增协作协议模块

文件：`agenticx/runtime/group_workflow.py`（新建）

新增以下纯数据结构和辅助函数：

- `ReviewStatus`: `pass` / `pass_with_risk` / `revise` / `fail`。
- `ReviewIssue`: `severity`、`problem`、`fix`。
- `ReviewDecision`: 审核状态、摘要、问题、亮点；`accepted` 仅对 `pass` 和 `pass_with_risk` 为真。
- `WorkflowMember`: 分身 id、名称、角色、长期提示。
- `WorkflowStageRecord`: 节点、执行者、审核者、历次产出、最终审核状态和失败原因。
- `parse_review_decision(raw_text)`: 支持纯 JSON、Markdown fenced JSON 和中文/英文文本降级解析；出现 P0 时即使模型返回 `pass` 也强制改为 `revise`。
- `select_reviewer(members, executor_id, task_index)`: 排除执行者，优先选择角色/提示中包含审核、质量、验收、风险、编辑等职责的成员；同分时按任务序号轮转。没有其他成员时返回 `None`，由调用方使用 Meta 负责人审核。
- `build_review_prompt(...)`: 把原始请求、当前子任务、依赖产出、候选产出和固定 JSON schema 交给审核者；要求检查事实依据、任务覆盖、内在一致性、可执行性和交付完整度。
- `build_rework_prompt(...)`: 把上一版产出和审核问题逐项交还原执行者，要求输出完整修订版而不是只解释修改计划。
- `render_review_for_group(decision)`: 把审核 JSON 转成面向用户的简洁审核消息。
- `render_execution_dossier(records)`: 为负责人生成不依赖最近消息窗口的完整执行档案，并设置总长度上限。
- `restore_member_runtime_state(...)` / `persist_member_runtime_state(...)`: 在 owner session 的 `scratchpad["group_workflow_member_state_v1"]` 中按 `group_id + avatar_id` 保存纯文本 `user/assistant` 历史；过滤 tool/system 链，限制消息条数和总字符，确保 JSON 可序列化。
- `write_group_deliverable(...)`: 使用 `ensure_group_workspace` 和 `atomic_write_text`，写入 `workspace/deliverables/<日期>-<主题>-<run_id>.md`；内容包括原始请求、各阶段执行/审核记录、最终答复。

审核 JSON 契约必须完整写入 prompt：

```json
{
  "status": "pass | pass_with_risk | revise | fail",
  "summary": "一句话审核结论",
  "issues": [
    {"severity": "P0 | P1 | P2", "problem": "具体问题", "fix": "具体修改要求"}
  ],
  "strengths": ["已做好的部分"]
}
```

门控规则：

- P0：关键事实无依据、核心任务缺失、产物不可用、安全/合规硬错误；必须 `revise` 或 `fail`。
- P1：显著影响质量或可执行性的缺陷；默认返工。
- P2：不阻塞交付的改进建议；允许 `pass_with_risk`。
- 无法解析审核输出：按 `revise` 处理，并给出“审核协议格式无效”的 P1 问题，防止静默放行。

### 4.2 成员独立上下文

文件：`agenticx/runtime/group_router.py`

锚点：`GroupChatRouter._run_one_target` 中 `local_session = StudioSession(...)` 之后，以及 `runtime.run_turn(...)` 循环前后。

Before：

```python
local_session = StudioSession(...)
...
async for event in runtime.run_turn(...):
    ...
```

After 意图：

```python
local_session = StudioSession(...)
restore_member_runtime_state(base_session, local_session, group_id, avatar_id)
try:
    async for event in runtime.run_turn(...):
        ...
finally:
    persist_member_runtime_state(base_session, local_session, group_id, avatar_id)
```

同时给 `_run_one_target` / `_run_one_target_stream` 增加默认值为 `True` 的 `append_to_context` 参数。内部审核调用设为 `False`，避免原始 JSON 审核协议写进可见群历史；格式化后的审核消息由团队路径显式追加。

### 4.3 团队意图触发

文件：`agenticx/runtime/group_router.py`

锚点：`_is_complex_multistep_task` 附近和 `_run_intelligent_turn` 的自动团队分发条件。

新增 `_is_collaborative_team_request(user_input)`，仅匹配明确的团队协作表达，例如“大家讨论、你们讨论、一起分析、各自分析、交叉评审、共同完成、头脑风暴、会诊、辩论”。

自动分发条件改为：无显式 @、至少两个有效成员，且“多步骤任务或明确团队协作请求”命中。显式 @ 仍优先，普通问候仍走快速单答路径。

为防止明确的“大家讨论 / 分别分析”请求被规划器压缩成单个执行者：若团队规划只返回一个宽泛子任务，则按有效成员生成角色化、无依赖的独立首轮任务，并固定一人一份；若已有多个子任务但协调器错误地全部分给同一成员，则只在明确协作请求下把前两个及以上任务分散到不同成员。普通复杂任务仍完全尊重协调器的角色分配。

### 4.4 执行—审核—返工闭环

文件：`agenticx/runtime/group_router.py`

锚点：`GroupChatRouter._run_team_turn` 内的 `_node_runner`。

Before：执行者返回非空文本后直接 `TASK_COMPLETED`，Graph Scheduler 随后把节点设为 `DONE`。

After：

1. 从 `graph_run.depends_sources(node.id)` 读取依赖节点，并从已完成 `WorkflowStageRecord` 提取上游已审核产出，拼入 `subtask_input` 的“已审核上游交接”区块。
2. 执行者产出候选结果。
3. 使用 `select_reviewer` 选择另一位成员；调用其真实 `_run_one_target_stream(..., append_to_context=False)`，让审核者在自己的 AgentRuntime 和独立上下文里完成审核。
4. 解析审核协议，向群聊追加一条格式化审核消息，并把 reviewer/status/summary/issues 写入 `node.meta`。
5. `pass` / `pass_with_risk`：记录最终产出，发布 `TASK_COMPLETED`，节点方可正常结束。
6. `revise` / `fail`：若未超过 `group.review_max_retries`，把结构化问题交给原执行者返工并再次审核；默认最多 2 次返工。
7. 超过上限仍未通过：发布 `TASK_FAILED` 并抛出内部 `GroupWorkflowError`。Graph Scheduler 将节点置为 `FAILED`，依赖节点不会误执行；负责人终稿必须标明未闭环项，不能声称全部完成。
8. 每个阶段只把最终通过版本写入 TaskLock；候选版和返工过程保留在 `WorkflowStageRecord` 和群消息中。

并发边界：无依赖节点继续并行，保持“成员独立首轮”；审核和返工在单节点内部串行，避免同一阶段多版本竞态。

### 4.5 负责人交付与产物

文件：`agenticx/runtime/group_router.py`

锚点：`_run_meta_project_manager_reply` 和 `_run_team_turn` 的“Leader summary”。

- 给 `_run_meta_project_manager_reply` 增加 `delivery_mode: bool = False`。
- 普通群聊保持现有短聊规则；团队终稿调用传 `delivery_mode=True`，改用交付型结构：结论、整合结果、审核状态/未决风险、验证边界、下一步。
- 团队终稿的输入包含 `render_execution_dossier(stage_records)`，不依赖 `context.render_recent_dialogue()` 的 20 条窗口。
- 生成终稿后调用 `write_group_deliverable`；成功时：
  - 将 `ArtifactRef(kind="report")` 追加到 `graph_run.artifacts`；
  - 将 `workflow_reviewed`、阶段状态和 `deliverable_path` 写入 `graph_run.meta`；
  - 通过 `GraphRunStore.save` 持久化；
  - 在负责人可见答复末尾附上产物绝对路径。
- 产物写入失败只记录 warning，并在负责人答复中说明“结果已生成但文件保存失败”；不得丢失聊天终稿。

### 4.6 可配置返工上限

文件：`agenticx/runtime/harden_flags.py`

新增 `group_review_max_retries()`：

- 环境变量：`AGX_GROUP_REVIEW_MAX_RETRIES`
- 配置项：`group.review_max_retries`
- 默认：2
- 范围：0..4

`0` 表示审核未通过后不自动返工，直接以失败态交给负责人收口。

## 5. 测试计划与验收标准

### 5.1 新增纯逻辑测试

文件：`tests/test_group_workflow.py`（新建）

- `test_parse_review_json_and_fenced_json`：两种 JSON 形式均能解析。
- `test_p0_issue_overrides_false_pass`：模型声称 pass 但包含 P0 时，结果必须是 revise。
- `test_unparseable_review_fails_closed`：无法解析时产生 P1 格式问题且不放行。
- `test_select_reviewer_excludes_executor_and_prefers_quality_role`：审核者不是执行者，并优先质量角色。
- `test_member_state_round_trip_is_isolated_and_bounded`：两个成员历史不串台，恢复后只有 user/assistant 文本，条数/字符受限。
- `test_render_execution_dossier_contains_handoffs_and_gate_state`：负责人档案包含任务、执行者、审核者、最终状态和产出。
- `test_write_group_deliverable_creates_markdown`：在 `tmp_path` 下生成可读 Markdown，文件名不包含路径穿越字符。
- `test_explicit_collaboration_expands_single_plan_across_members`：单子任务规划在明确团队协作请求下扩展为不同成员的独立首轮，且每个节点均经过交叉审核。

### 5.2 扩展团队桥接测试

文件：`tests/test_smoke_group_workforce_bridge.py`

- 增加 `_is_collaborative_team_request` 的正反例。
- 验证明确团队讨论请求在无 @ 且至少两位成员时进入 `_run_team_turn`。
- 用 mock `WorkforcePattern`、GraphRunStore 和 `_run_one_target_stream` 跑一个节点：首次审核 `revise`，返工后 `pass`；断言执行者调用两次、审核者调用两次、只发布一次 `TASK_COMPLETED`、最终节点为 DONE。
- 审核连续失败超过上限时，断言节点为 FAILED，未发布 `TASK_COMPLETED`，负责人档案包含未闭环状态。
- 隐藏审核 JSON 不应直接进入 `GroupChatContext`；用户可见的是格式化审核消息。

### 5.3 回归命令

```bash
.venv/bin/python -m pytest -q tests/test_group_workflow.py tests/test_smoke_group_workforce_bridge.py tests/test_smoke_graph_scheduler_dag.py tests/test_smoke_group_progress_tool_step.py
```

如果仓库现有测试中存在与本任务无关的已知失败，必须单独列出，不得以本功能通过掩盖。

### 5.4 AC

- AC1：输入“请你们分别分析并交叉评审这个方案”时，在至少两位成员的智能路由群中进入团队路径；普通“你好”不进入。
- AC1.1：上述明确协作请求即使被规划器只拆成一个宽泛任务，也至少由两位不同成员完成独立首轮，不得退化为一人执行、其他成员只挂名。
- AC2：每个成功任务至少有一个不同身份的审核者；只有 `pass` / `pass_with_risk` 才发布 `TASK_COMPLETED`。
- AC3：审核返回 P0/P1 时，原执行者收到具体问题并输出完整修订版；默认最多两轮。
- AC4：依赖节点输入中包含上游已审核结果，且上游失败时下游不执行。
- AC5：同一群会话内成员上下文跨调用恢复，不同成员互不污染，重启后随 owner session scratchpad 恢复。
- AC6：负责人终稿基于完整阶段档案，明确成功、风险和未闭环项，不再无依据声称“全部完成”。
- AC7：成功团队轮次在群工作区生成 Markdown 产物，GraphRun 保存 artifact 引用，聊天终稿显示路径。
- AC8：不修改 Desktop 群编辑器、不暴露编排枚举、不新增过程气泡噪音。

## 6. No-scope-creep 检查

- 只提交本 plan、`group_workflow.py`、`group_router.py`、`harden_flags.py` 和直接相关测试。
- 不纳入工作区中现有的 Enterprise、Desktop token budget、Electron 启动等无关修改。
- 不顺手修复现有工具进度参数预览测试或其他历史失败。
- commit / PR 文案使用产品内中性表述，不出现外部产品或第三方对标名称。
