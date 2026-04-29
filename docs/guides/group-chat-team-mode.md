# 群聊智能任务编排（Workforce 自动 dispatch）

## TL;DR

**你不需要做任何配置。** 群聊默认 `intelligent` 路由会自动判断：

- 你 **@ 了某个分身** → 那个分身回复（保持原有行为）
- 你 **没有 @ 任何人** + 消息看起来是 **简单问答 / 闲聊** → Machi 智能选人（保持原有行为）
- 你 **没有 @ 任何人** + 消息看起来是 **复杂多步任务** → 自动启用 **Workforce 任务编排**：Machi 把任务拆成子任务、分配给合适的分身并行执行、最后汇总结果
- 谁都不响应 → Machi 兜底

整个过程对用户透明，无需切换路由策略，无需 `/team` 前缀。

---

## 触发 Workforce 的启发式

Machi 在 `intelligent` 路由下自动识别多步任务，触发条件（满足任一）：

### 强信号词（任一命中即触发）
- `步骤` / `第一步` / `第二步`
- `拆分` / `分解` / `分步`
- `并行`

### 顺序对（前后都命中即触发）
- `先...后...` / `先...再...`
- `1)...2)` / `1....2.` / `1、...2、`
- `一...二...`

### 弱信号词（仅当文本 ≥ 20 字时触发）
- `然后` / `接着` / `再` / `之后` / `先后`
- `并且` / `同时` / `分别` / `逐步`
- `调研` / `研究`

### 其它前置条件
- 用户没有 @ 明确的分身（也不是 @ Machi）
- 群聊有 ≥ 2 个分身

任一条件不满足时，仍走原 `intelligent` 路径（单 LLM intent 判断 → 选 avatar 回复 → Meta 兜底）。

---

## 例子

| 用户消息 | 触发 Workforce？ | 原因 |
|----------|----------------|------|
| `@小明 项目主页有什么内容？` | ❌ | 有明确 @ |
| `你好` | ❌ | 简单问候，不命中启发式 |
| `调研 X 库然后写 demo` | ✅ | 包含弱信号 `然后` 且 ≥ 20 字 |
| `先调研 streaming，再写代码` | ✅ | 命中 `先...再...` 顺序对 |
| `请按以下步骤执行：分析需求...` | ✅ | 强信号 `步骤` |
| `把这个任务分解一下` | ✅ | 强信号 `分解` |
| `天气怎么样？` | ❌ | 简单问题 |
| `1) 调查 ChromaDB 2) 写 demo` | ✅ | 顺序对 `1)...2)` |

启发式的目标是**避免假阳性**——把简单问题误送进 Workforce 会增加 token 开销且体验变慢。所以宁可漏检一个复杂任务（用户感觉跟以前一样自然），也不要把简单问题装模作样地分解。如果你确实想强制启用 Workforce，把消息里加上「请按步骤执行」或「先...再...」即可触发。

---

## Workforce 工作流

触发后的执行链路：

```
用户输入 (intelligent 路由 + 启发式命中)
   │
   ▼
TaskPlannerAgent 分解任务  ←─ AgentExecutor（仅 LLM 规划）
   │  发布 workforce.decompose_start / decompose_complete 事件
   ▼
CoordinatorAgent 分配任务  ←─ AgentExecutor
   │  发布 workforce.task_assigned 事件
   ▼
分身（Worker）逐个执行     ←─ AgentRuntime（全 Studio 能力：MCP/流式/确认门）
   │  发布 workforce.task_started / task_completed / task_failed 事件
   ▼
Leader 汇总              ←─ AgentRuntime
   │  发布 workforce.workforce_stopped 事件
   ▼
最终回答
```

---

## 控制操作（运行中）

Workforce 执行期间，Desktop 群聊输入区会出现以下按钮：

- **插入任务**：把当前输入框内容作为新子任务推入 TaskLock 队列
- **暂停 / 恢复 / 停止**

API 调用：

```bash
curl -X POST http://localhost:19080/api/groups/<group_id>/action \
  -H "Content-Type: application/json" \
  -d '{"action": "add_task", "session_id": "<session_id>", "data": {"task_description": "..."}}'
```

支持 action：`add_task` / `pause` / `resume` / `stop` / `skip_task`

---

## 事件流

实时 SSE 端点：

```
GET /api/groups/<group_id>/events?session_id=<session_id>
```

事件按 `workforce.*` 分类（详见 ADR `docs/adr/0002-group-chat-workforce-bridge.md`）。

---

## 跨任务经验沉淀

CoordinatorAgent 在每个复杂任务开始前会调用 `task_experience_retrieve`，结束前调用 `task_experience_learn`。经验存储在 `~/.agenticx/groups/<group_id>/experience.json`，跨会话复用。

---

## 与其它路由策略的关系

| Routing | 自动 Workforce dispatch？ | 何时使用 |
|---------|--------------------------|----------|
| `intelligent`（默认） | ✅ 复杂多步任务自动触发 | 推荐所有日常使用 |
| `user-directed` | ❌ | 只想严格按 @ 选人 |
| `meta-routed` | ❌ | 只想 Machi 选 1 个分身回复 |
| `round-robin` | ❌ | 只想轮流 |
| `team`（API 兼容，UI 不暴露） | 强制每条消息都 Workforce | 仅 API 调试 / 已设置过的老用户 |

---

## 相关资源

- ADR: `docs/adr/0002-group-chat-workforce-bridge.md`
- Plan: `.cursor/plans/2026-04-29-group-chat-workforce-bridge.plan.md`
- 调研: `research/codedeepresearch/jiuwenclaw/`
- 启发式实现: `agenticx/runtime/group_router.py:_is_complex_multistep_task`
- 测试: `tests/test_smoke_group_workforce_bridge.py::TestComplexMultistepHeuristic`
