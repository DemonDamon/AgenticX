---
name: group-chat-workforce-bridge
overview: AgenticX 群聊路径桥接到 collaboration/workforce 现有能力 — 在 group_router.py 新增 routing="team" 分支，复用 WorkforcePattern + TaskLock + WorkforceEventBus + 5 种 Recovery；不重写 collaboration 内核，仅写胶水 + Studio SSE 端点 + Desktop UI 接通；同时新增 task_experience_* 3 工具与 mention_hops 配置化。
todos:
  - id: t00-adr
    content: ""
    status: completed
  - id: t01-api-smoke
    content: ""
    status: completed
  - id: t02-config-routing
    content: ""
    status: completed
  - id: t03-router-bridge
    content: ""
    status: completed
  - id: t04-router-dispatch
    content: ""
    status: completed
  - id: t05-tasklock-integration
    content: ""
    status: completed
  - id: t06-event-mapping
    content: ""
    status: completed
  - id: t07-studio-sse
    content: ""
    status: completed
  - id: t08-mention-hops-config
    content: ""
    status: completed
  - id: t09-task-experience-tools
    content: ""
    status: completed
  - id: t10-leader-prompt
    content: ""
    status: completed
  - id: t11-desktop-task-tabs
    content: ""
    status: completed
  - id: t12-desktop-actions
    content: ""
    status: completed
  - id: t13-desktop-routing-switch
    content: ""
    status: completed
  - id: t14-desktop-mention-hops
    content: ""
    status: completed
  - id: t15-tests-bridge-smoke
    content: ""
    status: completed
  - id: t16-tests-legacy-regression
    content: ""
    status: completed
  - id: t17-tests-eval-suite
    content: ""
    status: completed
  - id: t18-docs-user-guide
    content: ""
    status: completed
  - id: t19-conclusion-update
    content: ""
    status: completed
isProject: false
---

# AgenticX 群聊 Workforce 桥接 — 工程计划

> Plan-Id: `group-chat-workforce-bridge`
> Plan-File: `.cursor/plans/2026-04-29-group-chat-workforce-bridge.plan.md`
> 回溯研究产物：
> - `research/codedeepresearch/jiuwenclaw/jiuwenclaw_proposal.md` (v2)
> - `research/codedeepresearch/jiuwenclaw/jiuwenclaw_agenticx_gap_analysis.md` (v2)
> - `research/codedeepresearch/jiuwenclaw/jiuwenclaw_source_notes.md`

## 0. 背景

`/codedeepresearch https://github.com/openJiuwen-ai/jiuwenclaw` 调研结论：

- **AgenticX 已具备**：`WorkforcePattern`（CAMEL-AI 风格 coordinator-planner-worker）、`TaskLock`（项目级状态 + Action Queue）、`WorkforceEventBus`（30+ 事件）、5 种 Recovery（RETRY/REASSIGN/DECOMPOSE/REPLAN/CREATE_WORKER）、`delegate_to_avatar` 真委派、`TodoManager`、`ConversationManager`、`MemoryHook`、`hybrid_search.py`
- **AgenticX 不足**：`agenticx/runtime/group_router.py`（51 KB 简单 router）**没有桥接到** `agenticx/collaboration/workforce/`，导致用户在群聊中体验不到任务编排
- **唯一无 AgenticX 等价物的 jiuwenclaw 设计**：E2A 统一信封三层模型 → **不在本 plan**，独立后续 plan 与 IM Gateway 合并
- **真正可借鉴的工具语义**：`experience_retrieve / learn / clear` 3 工具语义（用于 leader 主动检索/记录跨任务经验）→ 在本 plan G6 落地

**结论**：本 plan 不重写 `collaboration/workforce/` 内核；只在 `runtime/group_router.py` 与 `studio/server.py` 写胶水代码 + Desktop UI 接通。预计 3-5 天。

---

## 1. 强约束（不松口）

- **零破坏**：现有 4 种 routing（`intelligent` / `user-directed` / `meta-routed` / `round-robin`）零修改、零回归
- **零新依赖**：所有桥接基于 AgenticX 现有 `collaboration/` 模块
- **零 collaboration 内核改动**：`agenticx/collaboration/workforce/*.py` / `task_lock.py` / `manager.py` 完全不动
- **routing 默认仍为 `intelligent`**：用户必须显式在 group.yaml 改成 `routing: "team"` 或在 SettingsPanel 切换才生效
- **失败可零成本回滚**：本 plan 是纯增量分支，回退仅需 revert PR

---

## 2. 契约（t01 必须先冻结）

### 2.1 WorkforcePattern API 调用面（t01 验证）

```python
from agenticx.collaboration.manager import CollaborationManager
from agenticx.collaboration.enums import CollaborationMode
from agenticx.collaboration.workforce.events import WorkforceEventBus

manager = CollaborationManager()
event_bus = WorkforceEventBus()
result = await manager.create_collaboration(
    pattern=CollaborationMode.WORKFORCE,
    coordinator_agent=coordinator,   # 由 Meta-Agent 配置构造
    task_agent=task_planner,         # 由 group system prompt 构造
    workers=workers,                 # 由 group avatars 一一映射
    llm_provider=llm,
    event_bus=event_bus,
)
async for evt in event_bus.subscribe_async(...):  # 或 get_next_event 轮询
    yield convert_to_group_reply(evt)
```

**待 t01 校验**：以上 API 是否与 `workforce_pattern.py:WorkforcePattern.execute()` / `manager.py:CollaborationManager.create_collaboration()` 实际签名一致；如有出入，桥接代码相应调整。

### 2.2 GroupReply 事件类型命名约定

| WorkforceAction (来自 events.py:22-54) | GroupReply.event_type | UI 区域 |
|----------------------------------------|----------------------|---------|
| `decompose_start / progress / complete / failed` | `workforce.decompose.<sub>` | 任务区顶部 |
| `task_assigned / started / completed / failed / skipped` | `workforce.task.<sub>` | 任务区列表 |
| `agent_activated / deactivated` | `workforce.agent.<sub>` | 成员区 |
| `toolkit_activated / deactivated` | `workforce.toolkit.<sub>` | 成员区（默认折叠） |
| `user_message` | `workforce.message.user` | 消息区 |
| `assistant_message` | `workforce.message.assistant` | 消息区 |
| `workforce_started / stopped / paused / resumed` | `workforce.system.<sub>` | 顶栏状态 |

### 2.3 TaskLock project_id 命名

```
project_id = f"group::{group_id}::{session_id}"
```

跨群、跨 session 严格隔离；不与现有 `delegate_to_avatar` 的 avatar session id 冲突。

### 2.4 SSE 端点契约

```
GET  /api/groups/{group_id}/events             → text/event-stream
POST /api/groups/{group_id}/action             → 200 OK / 400
        body: { "action": "ADD_TASK" | "PAUSE" | "RESUME" | "STOP" | "SKIP_TASK", 
                "session_id": "...", 
                "data": {...} }
```

---

## 3. 模块改造点（最小化）

```text
完全不动（复用）：
  agenticx/collaboration/workforce/        ← WorkforcePattern / events.py / coordinator.py / worker.py / ...
  agenticx/collaboration/task_lock.py
  agenticx/collaboration/manager.py
  agenticx/collaboration/conversation.py
  agenticx/collaboration/delegation.py
  agenticx/runtime/team_manager.py         ← AgentTeamManager（spawn/cancel/retry）
  agenticx/runtime/todo_manager.py
  agenticx/runtime/hooks/memory_hook.py
  agenticx/memory/hybrid_search.py

修改现有（少量胶水）：
  agenticx/avatar/group_chat.py            ← GroupChatConfig.routing 增 "team"（1 行）
  agenticx/runtime/group_router.py         ← 增 _run_team_turn (~250 行) + run_group_turn 分支（5 行）+ mention_hops 配置化（~10 行）
  agenticx/cli/agent_tools.py              ← 增 task_experience_* 3 个工具（~200 行）
  agenticx/studio/server.py                ← 增 SSE + Action 端点（~80 行）

Desktop 前端：
  desktop/src/components/group/<新>        ← 任务区 / 成员区 tab
  desktop/src/store.ts                     ← 群聊事件分类状态
  desktop/electron/main.ts + preload.ts    ← IPC 桥接 group action
  desktop/src/components/settings/         ← routing 下拉 + mention_hops 滑块
```

---

## 4. 实施阶段

### Phase 0：ADR + API 校验（0.5 天）

- [ ] **t00**：写 ADR `docs/adr/2026-04-29-group-chat-workforce-bridge.md`
- [ ] **t01**：写最小 smoke 验证 WorkforcePattern 实际 API 形态（不改 group_router）

### Phase 1：MVP 桥接（2-3 天）

- [ ] **t02**：`GroupChatConfig.routing` 增 `"team"`
- [ ] **t03**：`group_router.py` 增 `_run_team_turn`
- [ ] **t04**：`run_group_turn` 入口分支
- [ ] **t05**：`get_or_create_task_lock` 集成
- [ ] **t06**：WorkforceEvent → GroupReply 映射
- [ ] **t07**：Studio SSE + Action 端点
- [ ] **t08**：mention_hops 配置化
- [ ] **t11**：Desktop 任务区 / 成员区 tab
- [ ] **t12**：Desktop 插入任务 / 暂停 / 恢复 / 停止按钮
- [ ] **t13**：SettingsPanel routing 下拉
- [ ] **t15**：bridge smoke 测试
- [ ] **t16**：legacy regression 测试

**Done criteria**：
- 用户在 SettingsPanel 选 routing="team"，发送"调研 X 然后写 demo"，看到 leader 创建至少 2 任务、worker 分别完成、leader summarize 全过程
- 4 种 legacy routing 行为完全不变（回归测试通过）

### Phase 2：经验沉淀 + 评测（1-2 天）

- [ ] **t09**：`task_experience_*` 3 个 STUDIO_TOOLS
- [ ] **t10**：CoordinatorAgent 系统提示加入 retrieve 引导
- [ ] **t14**：SettingsPanel mention_hops 滑块
- [ ] **t17**：5 条评测 prompt
- [ ] **t18**：用户文档
- [ ] **t19**：更新 conclusions

**Done criteria**：5 条 prompt 中 4+ 条 success_rate=1.0；token p50 增长 < 50%

---

## 5. 评测任务集（t17 锚点）

```yaml
- id: simple_qa
  prompt: "@xxx 项目主页有什么内容？"
  routing_setting: intelligent       # 不进入 team 模式
  expect_no_workforce_actions: true  # legacy 路径完全不触发 Workforce

- id: research_then_implement
  prompt: "/team 帮我调研一下 X 库，然后基于它写一个 hello world demo"
  routing_setting: team
  expect_workforce_actions: [decompose_start, decompose_complete, task_assigned, task_completed, workforce_stopped]
  expect_min_tasks: 2
  expect_task_completion_rate: 1.0

- id: parallel_subtasks
  prompt: "/team 同时做这两件事：1) 调查 ChromaDB vs Milvus 2) 写一段 RAG 入库 demo"
  routing_setting: team
  expect_min_workers_active: 2

- id: insert_during_execution
  routing_setting: team
  prompt_seq:
    - "/team 调研 A 库的 streaming API"
    - "现在改成调研 B 库的"
  expect_actions_via_api: [ADD_TASK, SKIP_TASK]

- id: experience_reuse
  routing_setting: team
  prompt_seq:
    - "/team 解 issue X（涉及 chunked vector）"
    - "/team 解类似的 issue Y"
  expect_tool_calls: [task_experience_retrieve, task_experience_learn]

- id: regression_legacy
  prompt: "@avatar1 你好"
  routing_setting: intelligent
  expect_no_workforce_actions: true
  expect_routing_path: "intelligent_legacy"
```

---

## 6. 风险与回滚

| 风险 | 概率 | 影响 | 缓解 |
|------|------|------|------|
| WorkforcePattern API 与桥接预期不一致 | 中 | 中 | t01 先做 API smoke，发现差异立即调整 |
| LeaderAgent 死循环 | 中 | 中 | `Agent.max_iterations: 50` + `coordinator.completion_timeout: 300s` 强约束 |
| 4 种 legacy routing 回归 | 低 | 高 | t04 分支零侵入；t16 强制回归测试 |
| EventBus → SSE 数据竞争 | 中 | 中 | 复用 events.py:144 同步机制；SSE 端点用独立 queue |
| TaskLock 跨 session 串台 | 低 | 高 | project_id 全限定 `group::<gid>::<sid>` |
| avatars 数量过多导致 worker 创建超时 | 中 | 中 | 限制 `MAX_WORKERS_PER_GROUP = 5` |

**回滚策略**：
- Phase 1 不达标 → 不合并 PR；可单独 cherry-pick t08 / t14（mention_hops 独立小补丁）
- Phase 2 不达标 → routing="team" 默认 disabled，仅在 SettingsPanel 显式开启
- 完全失败 → revert PR，零 collaboration 内核污染

---

## 7. 与现有 plan 关系

| 现有 plan | 关系 |
|-----------|------|
| `.cursor/plans/2026-03-30-im-remote-command-gateway.plan.md` | E2A 简化信封（jiuwenclaw 唯一无 AgenticX 等价物的设计）→ **独立后续 plan** 与之合并，不在本 plan |
| `.cursor/plans/2026-04-08-cc-local-bridge-machi.plan.md` | ACP Adapter（VS Code 接入）→ 独立后续 plan |
| `.cursor/plans/2026-04-14-machi-kb-stage1-local-mvp.plan.md` | task_experience_* 工具复用 hybrid_search.py（KB Stage 1 已有） |

---

## 8. 范围外（独立后续 plan）

| 独立后续 | 说明 |
|----------|------|
| E2A 统一信封 | 与 IM Gateway plan 合并 |
| A2A Server | 需 `a2a-sdk` 新依赖（alpha 版），先评估稳定性 |
| ACP Adapter | VS Code Client 接入，手写 JSON-RPC |
| 分布式 Team（pyzmq + A2X registry）| 与 Desktop SDK 形态冲突，远期 |
| 团队级 Skill 演进 | 在 group 级 evolutions.json 汇总，边缘 case |

---

## 9. 验收门禁

- [ ] **t15** bridge smoke 通过（research_then_implement 任务）
- [ ] **t16** legacy regression 通过（4 种 routing 零回归）
- [ ] **t17** 5 条评测 4+ 通过，success_rate >= 0.8
- [ ] **typecheck** 通过（Python + Desktop TS）
- [ ] **token_overhead_p50** < 50%（vs legacy intelligent）
- [ ] **conclusions/runtime_module_conclusion.md** 与 **conclusions/avatar_module_conclusion.md** 已更新（t19）

## 10. 提交规范

每次 commit 必须包含：
```
Plan-Id: group-chat-workforce-bridge
Plan-File: .cursor/plans/2026-04-29-group-chat-workforce-bridge.plan.md
Made-with: Damon Li
```
