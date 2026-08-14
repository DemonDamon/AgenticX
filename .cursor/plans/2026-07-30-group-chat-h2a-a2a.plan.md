# SP4: 群聊 H2A / A2A 人味对齐（并投影到 Graph）

Planned-with: Cursor Grok 4.5
Suggested-Impl-Model: Cursor Grok 4.5
Parent: `.cursor/plans/pending/2026-07-30-near-graph-godview-master.plan.md`
Depends-on: `2026-07-30-graph-runtime-core`（事件钩子）；UI 完整体验依赖 SP3

**Goal:** 提升 human→multi-agents 与 agents↔agents 的过程体验，使其更接近真人微信群：少过程噪音、接话自然、争论可收敛；并把「谁在跟谁说话 / 协同」投影为 Graph 的 MESSAGE 边，供上帝视角观测。

**Architecture:** 不改默认 intelligent 路由哲学。增强：A2A follow-up 边事件、讨论升温检测、收敛政策接口（复用 SP2 selection_rule）、H2A 指令在图上显示为 HUMAN→agent 边。聊天侧继续用聚合 progress，不把每个工具打成气泡。

**Tech Stack:** `group_router.py`、`group_context.py`、既有 `group_progress` SSE、SP1/SP2 graph events。

---

## 问题陈述（人味缺口）

今日群聊已有：@ 路由、Meta 兜底、mention follow-up（hops≤2）、progress 单行聚合、Workforce 线性/（SP1 后）DAG 任务。

仍不像「人群」的点：

1. A2A 接话存在，但用户难以一眼看到「谁在跟谁争」——只见气泡顺序。
2. 争论可能拉长（多 hop），缺少人类一句「先定一版」的结构抓手（SP2 I4 提供后端，本 SP 做自动升温提示 + 边投影）。
3. H2A：用户一句@多人时，图上应出现一人对多节点的扇出，而不仅是多条独立回复。
4. 协同任务边（depends）与闲聊边（message）未区分——上帝视角会糊。

---

## In Scope / Out of Scope

### In Scope

- 发射 `graph.edge_flow` / `graph.edge_updated`（kind=message）当 A2A follow-up 发生
- H2A：用户消息解析出的 targets → 临时 HUMAN 节点边
- 「讨论升温」启发式：短窗口内互 @ ≥N → 可选系统轻提示（一条，不刷屏）建议用户打开运行图下规则
- 确保 converge policy（SP2）与 follow-up 联动已接线（若 SP2 未合入则本 SP 做最小 flag）
- Chat 内对 MESSAGE 边 **不** 新增气泡；仅 progress/图

### Out of Scope

- 恢复编排模式下拉框
- 每个工具调用变群聊气泡（禁止回潮）
- 重写 Meta PM 长提示全文
- I10 Promote Chat→Task 完整向导（可留 hook：`op` 预留）

---

## 精确改动

### 1. A2A 边投影

**修改：** `agenticx/runtime/group_router.py` — `_emit_mention_follow_ups`

**Before：** 只调度被 @ 成员回复。
**After：** 调度前/后调用：

```python
on_graph_event({
  "type": "graph.edge_updated",
  "run_id": current_run_id_or_none,
  "edge": {
    "id": f"msg_{source}_{target}_{ts}",
    "kind": "message",
    "source": source_agent_id,
    "target": target_agent_id,
    "label": "mention",
  },
})
on_graph_event({
  "type": "graph.edge_flow",
  "edge_id": "...",
  "summary": truncate(reply_preview, 80),
})
```

若当前 session 无 GraphRun：compiler 提供 `ensure_ephemeral_run(session_id, group_id, member_ids)`——**仅投影用**，节点=成员，无 TASK 边；避免「没任务就没图」。

落点：`agenticx/runtime/graph/compiler.py` 增加 `ensure_presence_run(...)`。

### 2. H2A 扇出边

**修改：** `_run_intelligent_turn` 在确定 `targets` 之后：

- 对每个 target：边 `human → target` kind=message label=`user`
- 若走 team/DAG：另有 depends 边（SP1），二者共存

### 3. 升温提示（单次高信号）

启发式（写死可测）：

- 同一 `active_thread` 60s 内 MESSAGE 边往来 ≥4 且涉及 ≥2 agents
- 且无已有 `graph_policy::converge`
- 则最多 **一次** emit `group_progress` 或系统行：`讨论较热，可在右侧「运行图」框选相关成员并点「快速出结论」`
- 使用 scratchpad `debate_nudge_sent=true` 防重复

**禁止** 每轮都提示。

### 4. 人味文案与节奏（小改，防 scope creep）

仅限：

- Workforce 任务分配系统行保持短句（已有则不动）
- Meta 开放提问路径：若已 @ 某成员，避免 Meta 再客套长篇（检查 `_run_meta_project_manager_reply`：若 intent 已 route_to 成员则缩短 PM 前言）——**仅当存在明显冗长路径时改**；无测试证明则跳过，避免倒退

### 5. Desktop 最小配合（若 SP3 已合并）

- MESSAGE 边用虚线样式（SP3 已规划）
- 升温提示文案中的「运行图」可点击 → `openSidePanel(..., "graph")`

若 SP3 未合并：本 SP 只做后端事件 + 聊天轻提示。

---

## FR / AC

| ID | AC |
|----|-----|
| FR-1 | follow-up 触发时 store/SSE 出现 kind=message 边（单测 mock on_graph_event） |
| FR-2 | 用户消息多 target 时产生 ≥2 条 human→agent 边 |
| FR-3 | 升温条件满足时恰好 1 次 nudge；再次互 @ 不再发 |
| FR-4 | converge flag 存在时 mention follow-up 不扩散（与 SP2 对齐回归） |
| FR-5 | 无新增「每工具一条群聊气泡」回归：现有 `group_progress` 单行语义保持 |

测试：

- `tests/test_smoke_group_a2a_graph_edges.py`
- `tests/test_smoke_group_debate_nudge.py`

---

## 实施任务

### Task 1: `ensure_presence_run` + 单测

### Task 2: `_emit_mention_follow_ups` 边事件

### Task 3: H2A 扇出边

### Task 4: 升温 nudge + scratchpad 防抖

### Task 5: 与 SP2 converge 回归测试

### Task 6:（可选）ChatPane 提示点击打开运行图——仅 SP3 已存在时

---

## 风险

- 无任务时也建 presence run：注意 GC——session 结束或空闲关闭 run（简单：session delete 时删；或不持久化 presence，仅内存）。**推荐：** presence run 持久化但 `meta.ephemeral=true`，列表 API 可过滤。
- 边事件过多：同一对 agents 边复用 id `msg_{a}_{b}`，只发 flow pulse，不每次新建边。
- 提示文案打扰：严格一次。

---

## 与主规划干预的关系

本 SP 让「激烈讨论」在图上可见；用户用 SP3 的 I4 收敛。没有本 SP，上帝视角只能看见任务 DAG，看不见吵架——不符合「观测沟通与协同」目标。
