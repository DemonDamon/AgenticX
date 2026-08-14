# SP2: Graph Intervention API + `graph.*` SSE 投影

Planned-with: Cursor Grok 4.5
Suggested-Impl-Model: Cursor Grok 4.5
Parent: `.cursor/plans/2026-07-30-near-graph-godview-master.plan.md`
Depends-on: `2026-07-30-graph-runtime-core`

**Goal:** 提供统一干预 API 与稳定的 `graph.*` SSE 事件契约，落地主规划 I1–I6 的后端语义（含运行中改道规则），让 Desktop 上帝视角面板（SP3）只消费契约而不各自解析 chat 碎片。

**Architecture:** `intervene.py` 校验 → 改 GraphRun → 通知 scheduler / 向目标节点 AgentRuntime 注入系统通知。chat SSE 增加规范化 `graph.*` 事件；REST 提供 snapshot + intervene + 可选 events replay。

**Tech Stack:** FastAPI routes in `server.py`（精确追加）、asyncio Event 唤醒 paused run、复用 confirm/clarify/subagent cancel。

---

## In Scope / Out of Scope

### In Scope

- I1 Node Inject、I2 Node Retract、I3 Edge Reassign、I4 Selection Rule、I5 Pause/Resume、I6 Cancel Node
- SSE：`graph.run_created` / `graph.node_updated` / `graph.edge_updated` / `graph.edge_flow` / `graph.intervention_applied` / `graph.run_status`
- `POST /api/graph/runs/{run_id}/intervene`
- 运行中改道规则与冲突（version 乐观锁）

### Out of Scope

- Desktop 画布（SP3）
- I7–I12 完整实现（可在 enum 留位返回 501）
- 绕过 ConfirmGate 的强制批准
- 独立 `/api/groups/{id}/events` bus 大修（继续走主 chat SSE；可选后续）

---

## API 契约

### `POST /api/graph/runs/{run_id}/intervene`

**Request body：**

```json
{
  "op": "node_inject",
  "version": 12,
  "node_ids": ["n_t2"],
  "edge_ids": [],
  "payload": {
    "text": "增加验收清单：必须包含性能数字"
  }
}
```

**ops（P0）：**

| op | payload | 行为 |
|----|---------|------|
| `node_inject` | `{text}` | append `node.directives`；若 RUNNING，向该 agent session 注入 `[系统通知][graph_inject] ...`（不写 user 气泡，或写一条轻量 system 可视——产品选：**写 group 系统行 + 注入 runtime**） |
| `node_retract` | `{text}` | append directive `RETRACT: ...`；scheduler 在节点完成条件检查时跳过匹配子目标（最小：注入通知让模型停止该部分） |
| `edge_reassign` | `{edge_id, new_target_node_id}` 或 `{edge_id, new_agent_id}` | 见下方规则 |
| `selection_rule` | `{text, node_ids, edge_ids}` | 写入 run.meta.policies[]；对涉及 MESSAGE 边的 agent 注入收敛指令；将 `mention_hops` 临时压到 0/1（session scratchpad flag） |
| `pause` | `{scope: "node"|"run", node_ids?}` | status→paused |
| `resume` | 同上 | 唤醒 |
| `cancel_node` | `{node_ids}` | 调现有 cancel；节点 CANCELLED；下游默认 BLOCKED 除非 payload.skip_downstream=true→SKIPPED |

**Response：**

```json
{
  "ok": true,
  "run_id": "...",
  "version": 13,
  "applied": ["node_inject"],
  "warnings": []
}
```

version 不匹配 → `409 { "error": "version_conflict", "version": <server> }`。

### 落点

- 新建：`agenticx/runtime/graph/intervene.py`
- 新建：`agenticx/runtime/graph/events.py` — `def graph_event(type: str, run_id: str, **data) -> dict`
- 修改：`agenticx/studio/server.py` — 精确追加路由函数，**勿整段替换 import**
- 修改：`agenticx/runtime/graph/scheduler.py` — 订阅 pause/cancel；执行前合并 directives 进 task_text

---

## Edge Reassign 规则（写死，禁止实施时「灵活发挥」）

对 `DEPENDS` 边 `A → B`（B 是任务节点）：

1. 若 B.status ∈ {pending, ready, blocked, paused}：
   - 将 B.agent_id 改为 C（或克隆新节点 C 并改边 target——**推荐改 agent_id**，边不变，更简单）
   - 用户说「拖线到 c」在 UI 映射为：边仍 A→taskX，但 taskX.agent_id=C；若 UI 以 agent 节点为端点，则 compiler 需同时维护 **agent 投影节点**（见下）
2. 若 B.status == running：
   - 默认拒绝，返回 `warnings: ["target_running"]`，除非 `payload.force: true`
   - force：cancel B 的运行 → 新节点或同节点换 agent → status=READY 重新入调度
3. 若 B.status ∈ {done, cancelled, skipped}：拒绝 `400`

**Agent 投影节点（供上帝视角）：**
SP1 任务节点已够调度；SP2 在 snapshot 中附加 `view.agents[]` 投影（按 agent_id 聚合任务节点），SSE `graph.node_updated` 可带 `view_role: "task"|"agent"`。实施时：

- Store 仍以 TASK 为调度权威
- `GET run` 返回 `projection: { agent_nodes, agent_edges }` 方便 UI 画「专家」点

---

## 注入运行中 Agent 的方式（Before/After）

**现有：** confirm/clarify 有专门通道；无通用「对某 avatar 追加指令」。

**After（最小可用）：**

在 `GroupChatContext` / session scratchpad 写入：

```python
scratchpad["graph_directives::<agent_id>"] = [
  {"ts": ..., "text": "...", "op": "node_inject"},
]
```

在 `_run_one_target` / AgentRuntime 构造 user/system 前，读取并清空已消费 directives，拼进系统提示尾部：

```
## Graph intervention (authoritative)
- 增加验收清单：必须包含性能数字
```

单聊 spawn：对 `sa-*` 走同等 scratchpad key 或 `team_manager` 侧注入（优先复用 subagent 的 session_id）。

---

## SSE 事件契约（挂在 `/api/chat` 流）

与现有 event 并列，payload 形状：

```json
{
  "type": "graph.node_updated",
  "run_id": "gr_...",
  "version": 13,
  "node": { "id": "n_t2", "status": "running", "agent_id": "avatar_x", "label": "实现" },
  "throttle_key": "n_t2"
}
```

```json
{
  "type": "graph.edge_flow",
  "run_id": "gr_...",
  "edge_id": "e_msg_12",
  "kind": "message",
  "intensity": 1,
  "summary": "讨论接口契约"
}
```

**节流：** 同一 `throttle_key` 节点状态更新 ≥300ms 合并；`edge_flow` 对 thinking 不发全文，只发 pulse。

群聊路径：在 `group_router` 把 runtime 事件映射 progress 时，同步调 `on_event(graph_event(...))`。

---

## Selection Rule（I4）语义

`payload.text` 例：「快速出结论，先做一版」。

后端：

1. `run.meta.setdefault("policies", []).append({nodes, edges, text, ts})`
2. 对 `node_ids` 内每个 agent：`node_inject` 风格系统通知
3. 设置 `scratchpad["graph_policy::converge"] = {"max_mention_hops": 0, "until_ts": ...}`
4. `_emit_mention_follow_ups` 读取该 flag：若命中则 **跳过** 或 hops=0

落点：`agenticx/runtime/group_router.py` `_emit_mention_follow_ups`（搜索现有函数名，约 mention_hops 逻辑处）。

---

## FR / AC

| ID | AC |
|----|-----|
| FR-1 | `tests/test_smoke_graph_intervene_inject.py`：inject 后 node.directives 含文本且 version+1 |
| FR-2 | reassign pending：agent_id 变更；running 无 force → 不变更 + warning |
| FR-3 | pause run：scheduler 不再启动新节点；resume 后继续 |
| FR-4 | cancel_node：调用链触达 cancel（mock team_manager/subagent）节点 CANCELLED |
| FR-5 | selection_rule：scratchpad converge flag 存在且 follow-up 被抑制（单测 mock） |
| FR-6 | version_conflict 返回 409 |
| FR-7 | SSE 辅助：events.py 单测保证 type 字段稳定 |

---

## 实施任务

### Task 1: events.py + 契约单测

### Task 2: intervene.py 纯函数语义 + 单测（不启服务）

### Task 3: scheduler 响应 pause/cancel/directives

### Task 4: server 路由 `intervene` + GET 返回 projection

### Task 5: group_router 接线 directive 消费 + converge flag

### Task 6: server.py 冷启动 smoke

---

## 风险

- 注入被模型忽略：directive 必须标 `authoritative`；I2 retract 同理。P1 可加「硬跳过」结构化 checklist，本 SP 先软干预。
- 并行干预乱序：version 乐观锁强制。
- `server.py` 误伤：只追加 handler。
