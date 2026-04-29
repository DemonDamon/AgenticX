# 群聊 Team 模式（Workforce 结构化任务编排）

## 概述

AgenticX 群聊默认使用 `intelligent` 路由——Meta-Agent 根据上下文自动判断由哪个分身回复。

**Team 模式**（`routing="team"`）在此基础上启用了 **Workforce 三层协作架构**：

```
用户输入
   │
   ▼
Leader（Meta-Agent 角色）
   ├─ TaskPlannerAgent 分解任务
   ├─ CoordinatorAgent 分配任务给分身
   │
   ▼
分身（Worker，AgentRuntime 全 Studio 能力执行）
   ├─ 分身 A：调研子任务
   └─ 分身 B：实现子任务
   │
   ▼
Leader 汇总 → 最终答复
```

每一步都生成结构化事件（`workforce.task_assigned`、`workforce.task_completed` 等），前端可按区域展示任务进度。

---

## 何时使用 Team 模式

| 场景 | 推荐 routing |
|------|-------------|
| 简单问答 / 闲聊 | `intelligent`（默认） |
| 复杂多步任务（调研 → 实现 → 测试） | `team` |
| 需要多人并行协作 | `team` |
| 需要看到任务分解过程 | `team` |
| 用户希望插入新任务到执行队列 | `team` |

---

## 如何启用

### 在 Desktop 设置页

1. 打开群聊设置（点击群聊名称 → ⚙️ 设置）
2. 找到「路由策略」下拉菜单
3. 选择「**团队模式 · Workforce 结构化任务编排**」
4. 保存

### 通过 API

```bash
curl -X PUT http://localhost:19080/api/groups/<group_id> \
  -H "Content-Type: application/json" \
  -d '{"routing": "team"}'
```

### 通过 group.yaml

```yaml
id: <group_id>
name: My Team
avatar_ids: [avatar1_id, avatar2_id]
routing: team
```

---

## 使用方法

### 发送任务

直接发消息，Leader 会自动分解并分配：

```
/team 帮我调研 ChromaDB 和 Milvus 的对比，然后基于调研结果写一段 RAG 入库 demo
```

### 插入新任务（Team 模式下）

在输入框左侧点击 **「插入任务」** 按钮，输入框内容将作为新任务注入 TaskLock 队列（不会立即触发新的 LLM 调用，等待下一轮消费）。

### 暂停

点击输入框旁的 **「暂停」** 按钮（团队执行中时出现），发送 PAUSE 信号给 TaskLock。

### 通过 API 插入任务

```bash
curl -X POST http://localhost:19080/api/groups/<group_id>/action \
  -H "Content-Type: application/json" \
  -d '{"action": "add_task", "session_id": "<session_id>", "data": {"task_description": "新增一个单元测试"}}'
```

支持的 action：`add_task` / `pause` / `resume` / `stop` / `skip_task`

---

## 事件流 SSE

在 Team 模式下，Studio 会在以下端点暴露实时事件流：

```
GET /api/groups/<group_id>/events?session_id=<session_id>
```

事件按 `workforce.*` 命名空间分类：

| 事件类型 | 含义 | UI 区域 |
|----------|------|---------|
| `workforce.decompose_start` | 任务分解开始 | 任务区 |
| `workforce.decompose_complete` | 分解完成，显示子任务列表 | 任务区 |
| `workforce.task_assigned` | 任务分配给某分身 | 任务区 |
| `workforce.task_started` | 分身开始执行 | 成员区 |
| `workforce.task_completed` | 任务完成，包含摘要结果 | 任务区 |
| `workforce.task_failed` | 任务失败 | 任务区 |
| `workforce.agent_activated` | 分身被激活 | 成员区 |
| `workforce.message.assistant` | 分身发出的对话回复 | 消息区 |
| `workforce.system.workforce_stopped` | 全部任务结束 | 顶栏状态 |

---

## 跨任务经验沉淀

Team 模式下注册了三个 STUDIO_TOOLS：

| 工具 | 用途 |
|------|------|
| `task_experience_retrieve` | 任务开始时检索历史经验 |
| `task_experience_learn` | 任务结束前记录关键发现 |
| `task_experience_clear` | 清空群组经验库（需确认） |

经验存储路径：`~/.agenticx/groups/<group_id>/experience.json`

CoordinatorAgent 已被提示在每个复杂任务开始时调用 `task_experience_retrieve`。

---

## mention 多跳次数配置

Team 模式下 mention 跳数固定由 `_run_team_turn` 管理（基于任务分配）。Legacy routing 下的 `@mention` 跳数可通过 config.yaml 配置：

```yaml
# ~/.agenticx/config.yaml
group_chat:
  mention_hops: 3  # 默认 2，范围 1-10
```

---

## 技术限制

| 限制 | 原因 |
|------|------|
| 最多 5 个 Worker（分身） | `MAX_WORKERS_PER_GROUP = 5` |
| 最多 10 个子任务 | `MAX_DECOMPOSE_SUBTASKS = 10` |
| 任务分解层（Coordinator/Planner）无 MCP 工具 | 规划层使用 AgentExecutor（不含 Studio 工具集） |
| 执行层（Worker）有完整 Studio 能力 | 使用 AgentRuntime + 全 STUDIO_TOOLS + MCP + ConfirmGate |

---

## 与其他路由策略的兼容性

Team 模式是第 5 种路由策略，完全独立于其他 4 种：

- `intelligent`：保持原有行为（一次 LLM intent 判断 → 选 avatar 回复）
- `user-directed`、`meta-routed`、`round-robin`：保持原有行为

切换回这些策略后，Team 模式完全不生效。

---

## 相关资源

- ADR：`docs/adr/0002-group-chat-workforce-bridge.md`
- Plan：`.cursor/plans/2026-04-29-group-chat-workforce-bridge.plan.md`
- 研究产物：`research/codedeepresearch/jiuwenclaw/`
- 测试：`tests/test_smoke_group_workforce_bridge.py` / `test_smoke_group_legacy_routing.py`
