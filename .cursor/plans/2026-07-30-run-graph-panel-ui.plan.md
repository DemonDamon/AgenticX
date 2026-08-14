# SP3: Desktop Run Graph 上帝视角面板（右侧工作区）

Planned-with: Cursor Grok 4.5
Suggested-Impl-Model: Cursor Grok 4.5
Parent: `.cursor/plans/pending/2026-07-30-near-graph-godview-master.plan.md`
Depends-on: `2026-07-30-graph-intervention-api`

**Goal:** 在 ChatPane 右侧增加「运行图」面板：用数据流图画布实时观测 agents 思考/执行/沟通/协同，并支持 I1–I6 的点击与拖拽干预，形成「西部世界」式上帝视角。

**Architecture:** 新增 `sidePanelTab: "graph"`（与 workspace/members 并列）。面板用 `@xyflow/react` 渲染 projection（agent 节点 + depends/message 边）。订阅 chat SSE 的 `graph.*` + 轮询 `GET /api/graph/runs/{id}` 兜底。干预走 `POST .../intervene`。

**Tech Stack:** React、Zustand（`desktop/src/store.ts`）、`@xyflow/react`、既有 HoverTip / 主题 token（禁止硬编码 cyan 大按钮）。

---

## In Scope / Out of Scope

### In Scope

- 侧栏 Tab「运行图」
- 画布：节点状态色、边动画（flow pulse）、thinking 指示
- 干预：点节点注入/撤回、拖边改派、框选下规则、暂停/恢复/取消
- 与聊天双向高亮（messageId ↔ nodeId，能连则连）
- 空态：无 run 时说明「发送复杂任务或群聊协作后自动生成」

### Out of Scope

- 重做 Workspace 文件树
- 替换 SpawnsColumn（可「点击节点 → 若 spawn 则滚动/高亮 Spawns 卡」）
- I7–I12 完整 UI（菜单可显示「即将推出」禁用项）
- 移动端布局

---

## UI 落点（精确）

### 1. Store

**修改：** `desktop/src/store.ts`

- 扩展 `SidePanelTab`：`"workspace" | "members" | "graph"`
- `ChatPane` 增加可选：`activeGraphRunId?: string | null`
- `cycleSidePanel` / `openSidePanel` 支持 `"graph"`
- persist 兼容旧数据：缺省 tab 仍 workspace

### 2. 工具栏入口

**修改：** `desktop/src/components/ChatPane.tsx`（toolbar 区域，与工作区/历史/成员按钮并列）

- 新增图标按钮：活动/网络图示意（Lucide `GitBranch` 或 `Share2`——**不要用时钟**）
- tooltip：`运行图`（HoverTip）
- 点击：`openSidePanel(pane.id, "graph")` 并打开右侧面板
- 当收到 `graph.run_created` 时：若面板未开，**可**轻量 badge 点提示，**不要**强制抢焦点（避免打断打字）；用户偏好：首次 run 自动打开一次可用 localStorage `agx-graph-panel-autopen-v1`

### 3. 面板组件

**新建：**

- `desktop/src/components/graph/RunGraphPanel.tsx` — 容器
- `desktop/src/components/graph/RunGraphCanvas.tsx` — xyflow 画布
- `desktop/src/components/graph/GraphNodeView.tsx` — 自定义节点
- `desktop/src/components/graph/GraphInterveneDock.tsx` — 底部干预条
- `desktop/src/components/graph/graph-types.ts` — TS 类型对齐 SP2 契约
- `desktop/src/components/graph/useGraphRun.ts` — SSE 归约 + fetch snapshot

**挂载：** `ChatPane.tsx` 右侧面板渲染分支：`sidePanelTab === "graph"` → `<RunGraphPanel pane={...} />`
（搜索现有 `WorkspacePanel` / `GroupMembersSidePanel` 挂载点，并列增加，勿删工作区。）

### 4. 依赖

**修改：** `desktop/package.json` 增加 `@xyflow/react`（与当前 React 版本兼容的最新稳定版）。
不引入 dagre 也可：先用简易分层 layout（按 READY/RUNNING 列）；或加 `dagre` 若布局太丑——允许，但勿加故事性 UI 库。

---

## 视觉与状态映射

| 状态 | 节点外观 |
|------|----------|
| pending | 低对比描边 |
| ready | 实线 |
| running | 主题强调 + 呼吸（CSS，禁炫光 slop） |
| blocked | 警示色 + 「待你」角标 |
| paused | 暂停图标 |
| done | 成功弱化 |
| failed | 错误 |
| cancelled/skipped | 灰 |

边：

- `depends`：实线箭头
- `message`：虚线；`edge_flow` 时短促 dash 动画
- `artifact`：粗一点实线

主题：使用现有 CSS 变量（`text-text-strong` / `bg-surface-card` 等），三态 light/dim/dark 可读。

---

## 干预交互（对齐主规划）

### I1 / I2 点节点

1. 单击节点 → 选中 + Dock 展开
2. Dock 输入框 placeholder：`给该专家加一句指令，或说「xxx 不用做了」`
3. 发送：前端粗分——若文本匹配 `/不用做|取消|别做|跳过/` → `node_retract`，否则 `node_inject`
4. 乐观更新 directives 列表；409 则 refetch

### I3 拖边改派

1. 仅允许从 **任务/依赖边** 的 target 手柄拖到另一 **agent 节点**
2. pending/ready：直接 `edge_reassign`
3. running：`window` 不用 native confirm——用应用内小对话框（主题化）：「中断 B 并改派给 C？」→ `force: true`

### I4 框选规则

1. xyflow selectionOnDrag / 多选
2. Dock 第二模式：「对选中下规则」
3. 预设芯片：`快速出结论` / `先做一版` / `停止互相 @`（点击填入，可改）→ `selection_rule`

### I5 / I6

- 节点右键菜单（自定义，非浏览器原生）：暂停 / 恢复 / 取消
- 画布顶栏：整图暂停 / 恢复

### blocked 快捷

- blocked 节点点击：若有 pending confirm，复用现有确认 UI 入口（emit 或滚动到 ClarificationCard）——**不要**在图里重写权限协议

---

## SSE 归约

**修改：** `ChatPane.tsx` SSE handler（`graph.` 前缀分支，靠近现有 `workforce.` 处理约 L9118）

```ts
if (typeof payload.type === "string" && payload.type.startsWith("graph.")) {
  useGraphRunStore.getState().applyEvent(pane.id, payload);
  if (payload.type === "graph.run_created" && payload.run_id) {
    updatePane(pane.id, { activeGraphRunId: payload.run_id });
  }
}
```

可用 pane 局部 state 或轻量 zustand slice；**禁止**把整图 jsonb 塞进每条 Message。

---

## FR / AC

| ID | AC |
|----|-----|
| FR-1 | 工具栏可打开运行图；tab 持久化重启后仍在（若用户停在 graph） |
| FR-2 | 模拟 SSE `graph.node_updated` 后节点颜色变化（组件单测或手工） |
| FR-3 | inject API 被调用（mock fetch）且 Dock 清空 |
| FR-4 | 拖边 pending 触发 `edge_reassign` body 正确 |
| FR-5 | 框选 + 预设芯片发出 `selection_rule` |
| FR-6 | 无 run 空态文案可见，不白屏 |
| FR-7 | light/dim/dark 下节点文字对比度可读 |

测试文件建议：

- `desktop/src/components/graph/graph-types.test.ts`（纯函数归约）
- 若现有 vitest 配置允许：`RunGraphPanel` 烟雾渲染

---

## 实施任务

### Task 1: 加依赖 + types + useGraphRun 归约单测

### Task 2: RunGraphCanvas 只读观测（先不干预）

### Task 3: 侧栏 tab + toolbar 入口挂载

### Task 4: InterveneDock I1/I2/I5/I6

### Task 5: 边拖拽 I3 + 框选 I4

### Task 6: ChatPane SSE 接线 + 双向高亮（最小：点击节点 filter 该 agent 的 progress 行）

### Task 7: 主题与 a11y 扫一眼

---

## 风险

- xyflow 包体积：仅 graph tab 懒加载 `React.lazy`。
- 与 Spawns 信息重复：图上 spawn 节点 subtitle 显示短状态，详情仍 Spawns。
- 干预误触：running 改派必须二次确认。
