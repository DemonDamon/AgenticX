# Sub-Plan C：Near 工牌集群卡片 UI（工牌视觉 + 集群卡片 + 像素进度）

Planned-with: Claude Opus 4.8
Plan-Id: 2026-07-05-subagent-badge-cluster-card-ui
Plan-File: .cursor/plans/2026-07-05-subagent-badge-cluster-card-ui.plan.md
父规划: `.cursor/plans/2026-07-05-subagent-cluster-persistence.plan.md`
依赖: Sub-Plan B（返回契约；可先按 A 冻结 schema 搭骨架，联调接 B）
Suggested-Impl-Model: Opus 4.8（唯一必须上顶配之处——Near 专属工牌视觉品味是核心交付，弱模型易做成低端二次元感，不建议降档）

## 1. 需求

### FR（功能需求）

- **FR-1**：在 Meta 对话流内，将一次派生的多个子智能体渲染为一张 **Near 集群卡片（`SubAgentClusterCard`）**：卡片头「Agent 集群 · N 个并行任务」+ 成员行列表；每个成员行是一张**紧凑工牌（compact badge）**。对齐图1/图2 的信息层级，但视觉走 Near 品牌（见 2.3）。
- **FR-2**：**工牌（`AgentBadge`）** 作为独立可复用组件，承载子智能体身份：像素/线稿头像、名字、角色（如「供应链调研 · 彩讯股份」）、模型 pill、mono 编号（`01`）、状态徽章；hover / 展开时浮出**完整工牌**（大头贴 + persona 座右铭 + provider logo + 「角色说明」入口）。Lite 的 `SubAgentPanel` 可复用同组件。
- **FR-3**：**像素方格进度条（`PixelProgress`）**：对齐图4，用逐格点亮表达进度；运行中随 SSE / 轮询实时推进，完成后满格并收敛为「已完成」态。像素色走主题色（禁止硬编码绿色，用语义 token）。
- **FR-4**：集群卡片成员**可点击**，点击触发 `onOpenRun(runId)`（打开 Sub-Plan D 的右侧落盘 drawer）；选中态在卡片上有明确高亮（对齐图3 hover 浮层的视觉优先级）。
- **FR-5**：卡片数据源统一：运行中读全局 `subAgents[]`（SSE/轮询，实时）；历史/回看读 Sub-Plan B 的 `subagent-clusters` / `run` API（落盘态）。组件对两种来源**无感**（统一 view model，见 2.2）。
- **FR-6**：集群卡片默认**折叠为概览**（成员名 + 进度 + 编号一行），可展开看每个成员完整工牌；折叠语义与 `ToolCallCard` 一致（默认折叠、可展开）。

### NFR（非功能需求）

- **NFR-1**：视觉走 Near 品牌基调（黑白高对比度极客风，玛奇/NousResearch 神韵），不照搬 Kimi 的挂绳 + KIMI logo；配色/圆角/边框全部用主题 token（`bg-surface-card`、`border-border`、`--theme-color-rgb`、`--status-*`），在 dark/dim/light 三态均和谐可读。
- **NFR-2**：卡片宽度与既有 assistant 气泡对齐（复用 `ASSISTANT_INLINE_CARD_SHELL_CLASS` / `im-layout.ts` 的 maxWidth 与 20px icon rail 规范），不横向溢出。
- **NFR-3**：成员颜色分配复用 `avatar-color.ts`（分身按头像 hash、集群按 index 防撞色 `GROUP_PALETTE`），工牌 tint 用 `avatarTintBg`。
- **NFR-4**：进度/spinner 动画复用现有 `ArcSpinner`/`ThinkingDots` 语汇（避免静态 ⏳⏳，对齐「等待期须动态三点」偏好）；像素进度动画节流，避免高频重渲染。
- **NFR-5**：过程性广播（「已接收任务/正在调用工具 X」）**聚合进工牌进度/活动摘要**，不在对话流刷屏（对齐群聊「聚合为可折叠进度卡」偏好）。

### AC（验收标准）

- **AC-1**：派生 3 个子智能体 → 对话流出现 1 张集群卡片，头部显示「Agent 集群 · 3 个并行任务」，3 个成员各有名字/角色/编号 `01/02/03`。
- **AC-2**：运行中每个成员的像素进度条实时推进（可见格数增加），完成后满格 + 状态「已完成」。
- **AC-3**：dark/dim/light 三态切换，卡片与工牌无对比度问题、无硬编码色残留、无横向溢出。
- **AC-4**：点击成员触发 drawer 打开（Sub-Plan D）；选中成员有高亮。
- **AC-5**：hover/展开成员浮出完整工牌（大头贴 + persona + provider + 角色说明入口）。
- **AC-6**：同一组件在「运行态数据」与「B 的落盘态数据」下渲染一致（切 view model 源不改 UI）。

## 2. 技术方案

### 2.1 新增/改动组件

```
desktop/src/components/subagent/
├── SubAgentClusterCard.tsx    # 集群卡片（头 + 成员列表 + 折叠）
├── AgentBadge.tsx             # 工牌（compact + full 两态）
├── PixelProgress.tsx          # 像素方格进度条
├── badge-vm.ts                # view model：把 SubAgent(运行态) 与 RunRecord(落盘态) 归一为 BadgeVM
└── badge-theme.ts             # Near 工牌视觉常量（尺寸/像素格数/token 映射）
```

改动：`SubAgentCard.tsx` 的工牌/状态/复制/时间线逻辑逐步抽取到 `subagent/` 下复用（避免重复；`SubAgentCard` 保留为「运行态单卡」入口，内部改用新工牌组件），`SpawnsColumn.tsx` / `SubAgentPanel.tsx` 引用新组件。

### 2.2 统一 view model（FR-5 关键）

```typescript
// badge-vm.ts
export type BadgeVM = {
  runId: string;
  name: string;
  role: string;
  persona?: string;
  provider?: string;
  model?: string;
  badgeSeq: string;      // "01"
  status: SubAgentStatus;
  progress?: number;     // 0..1，运行态由事件推断，落盘态由 status 映射
  resultSummary?: string;
  outputFiles?: string[];
  clusterId?: string;
  source: "live" | "persisted";
};

export function fromLiveSubAgent(s: SubAgent): BadgeVM { /* ... */ }
export function fromRunRecord(r: RunRecord): BadgeVM { /* ... */ }
```

集群卡片只吃 `BadgeVM[]`；运行时优先 live，完成后由 Sub-Plan E 的收敛逻辑切到 persisted（同 runId 平滑替换，不闪烁）。

### 2.3 Near 工牌视觉规范（NFR-1，核心设计）

工牌不抄 Kimi 的挂绳 + 品牌 logo，改走 **Near 极客工牌**：

- **形态**：极简卡片，`rounded-lg border border-border bg-surface-card`；左侧一条 2px 的**成员主题色竖条**（`avatarTintBg` 派生）作为身份色标，替代 Kimi 的挂绳。
- **头像**：分身圆形 / 集群成员圆角方形（复用 `ChatImAvatar` 形态约定）；无头像时用像素首字母块（黑白高对比，呼应玛奇线稿气质）。
- **名字**：`text-text-strong` 半粗；**角色**：`text-text-muted` 一行（如「供应链调研 · 彩讯股份」）。
- **编号**：右上角 mono `01`（`font-mono text-text-faint`），呼应图2/图4 的编号语汇。
- **模型**：小 pill（`ProviderIcon` + 模型名），复用现有 pill 样式。
- **persona 座右铭**：full 态浮层内一行浅色斜体（如「进步即幸福」），来自 RunRecord.persona / avatar SOUL 摘要。
- **状态徽章**：复用 `SubAgentStatusBadge` 语义（running=主题色 ArcSpinner、completed=success、failed=error、paused=amber）。
- **compact ↔ full**：compact 是集群卡片内一行；hover ~280ms（用 `HoverTip` 延迟语汇）或点击「展开」浮出 full 工牌（`createPortal` 挂 body，避免被 `overflow` 裁剪，参考现有下拉 portal 经验）。

### 2.4 像素进度条（PixelProgress，FR-3）

- 一排 N 格（默认 20），已完成格 `bg-[rgb(var(--theme-color-rgb))]`，未完成格 `bg-[color-mix(in_srgb,var(--theme-color-rgb)_14%,transparent)]`，对齐图4 的方格质感但用主题色（非绿色）。
- `progress` 0..1 → 点亮 `round(progress*N)` 格；运行中无精确进度时用「呼吸推进」（当前活跃格闪烁）表达「进行中但不确定」。
- 完成满格；失败末格转 `--status-error`；暂停转 amber。

### 2.5 折叠与消息接入

- 集群卡片作为一种消息渲染变体（具体锚点消息类型由 Sub-Plan E 定义；C 阶段先在 `SpawnsColumn` / 独立容器中渲染并联调，E 阶段接入对话流锚点）。
- 折叠态复用 `ToolCallCard` 的 `useState(false)` + forceExpand 语义。

## 3. 验收标准与用例

- **用例 1（三态视觉）**：dark/dim/light 逐一截图集群卡片 + full 工牌 → 人工核对对比度/token/无溢出（可用 `control-ui` 或 browser 子代理截图）。
- **用例 2（实时进度）**：跑一个多工具子智能体 → 观察像素进度实时推进到满格。
- **用例 3（点击钻取）**：点击成员 → 触发 `onOpenRun`（D 阶段联调打开 drawer）；选中高亮正确。
- **用例 4（数据源无感）**：同一 cluster 用 live 数据与 B 的 persisted 数据分别喂 → 渲染一致。
- **用例 5（不刷屏）**：子智能体连发工具调用 → 对话流不新增气泡，进度/摘要聚合进工牌。

## 4. 风险与资源排期

| 风险 | 等级 | 缓解 |
|---|---|---|
| 抽取 `SubAgentCard` 逻辑引入运行态回归（严重倒退） | 高 | 先抽纯展示组件、保留 `SubAgentCard` 行为不变的适配层；每步 `npm run build` + 手动跑一次实时派生回归 |
| 工牌视觉「高品位」主观、来回返工 | 中 | 先出 dark 态一版定基调交互确认，再补 dim/light；视觉常量集中在 `badge-theme.ts` 便于调 |
| live→persisted 切换闪烁 | 中 | 按 runId 稳定 key + 同 VM 字段平滑过渡（Sub-Plan E 收敛），过渡期两源并存不清空 |
| 像素进度高频重渲染卡顿 | 低 | 进度节流（rAF/节流 setState），格数固定 20 |
| Lite/Pro 双路径复用成本 | 低 | 组件纯展示 + 回调注入，Pro/Lite 各自接线 |

**排期**：3 人天（1 工牌+像素进度组件与三态视觉 + 1 集群卡片与折叠 + 0.5 view model 归一 + 0.5 Pro/Lite 接线与回归）。可与 Sub-Plan B 并行（先按 A schema 搭骨架）。
