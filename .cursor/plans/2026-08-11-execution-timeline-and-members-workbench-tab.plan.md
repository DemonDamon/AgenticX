# 群聊私活可观测性：Execution Timeline + 成员面板迁入工作台

Planned-with: Opus 5
Suggested-Impl-Model: cursor-grok-4.5-high-fast（前端视觉/交互密集，需要甘特图排布审美 + 大文件精准搬迁；若拆分实施，FR-3/FR-4 的纯搬迁部分可交 composer-2.5-fast）

Plan-Id: 2026-08-11-execution-timeline-and-members-workbench-tab

## 背景与根因

上一轮（`2026-08-11-group-chat-process-observability.plan.md`）已把 `group_progress` 从消息流移出，并在**群成员侧栏**内新增「成员活动」竖列表（`MemberActivityList`）。用户实测后明确否决：竖列表只能回答「调用了哪些工具、共几次」，**回答不了「什么时候在干、干了多久、有没有并行」**，与参考产品 penguin-harness 的 Trajectory 页 **Execution Timeline（甘特式时间线：Model 车道 + 每工具一行 duration bar）** 差距是形态差距而非样式差距。

调研结论（`research/codedeepresearch/penguin-harness/`，upstream SHA `a41034c2ffa87297eac01331ff832388d3426bd1`，verdict **ADOPT**）：

- `TraceToolSpan`（`packages/server/src/api/types.ts:1151-1161`）= `callTs / approvalTs / outputTs + taskIndex`，未闭合字段留空即表示「进行中」。
- `TraceModelSegment`（同文件 `1136-1144`）= 串行模型车道 `thinking | text | tool_call`。
- `TimelineChart`（`packages/web/src/features/traces/timeline-chart.tsx:1-22,47-54,242-258`）= 固定 5 类色条（thinking / 模型回复 / 工具调用生成 / 审批等待 / 执行）、sticky 左侧标签列、**淡出其余**式高亮、Premiere 式缩放滑块（**不支持滚轮缩放**）、按 Task 分组各自独立时间轴。
- 明确不采纳（P1/NO-GAP）：append-only JSONL Trace + 服务端 `analyze`（G-002）、Overall token/成本卡（G-003）、subagent Trace 指针展开（G-004）。

同时用户提出两项 UI 位置调整（见附图）：

1. 群成员侧栏里的「成员活动」区块要**去掉**（不是改样式，是移除该区块）。
2. 顶栏 `Users`（群成员）按钮打开的**独立右侧成员面板**要**搬进工作台 WorkPanel**，与「任务摘要 / 浏览器 / 运行图 / 终端 / 工作区」并列成为一个 tab。

AgenticX 现状证据（本次改动的基线）：

| 能力 | 落点 | 符号 | 当前行为 |
|------|------|------|----------|
| 工具步骤 SSE | `agenticx/runtime/group_router.py` | `GroupReply.tool_name/tool_phase/tool_call_id`（~279-280）、`_runtime_event_to_tool_step` | 已有结构化 calling/done 事件 |
| 步骤 store | `desktop/src/components/graph/graph-types.ts` | `ToolStep`（43-50）、`toolStepsByNode`（106）、`applyToolStepToState`（124-146） | 每节点一维数组，含 `startedAt/updatedAt` |
| store 写入 | `desktop/src/components/graph/useGraphRun.ts` | `applyToolStep`（24,51-55） | pane 级 Zustand |
| 成员活动列表 | `desktop/src/components/graph/MemberActivityList.tsx` | `MemberActivityList` / `MemberRow` | 本次**删除** |
| 群成员侧栏 | `desktop/src/components/ChatPane.tsx:2044` | `GroupMembersSidePanel` | 头像网格 + 加/减成员 + 底部挂 `MemberActivityList`（2335-2340） |
| 顶栏成员按钮 | `desktop/src/components/ChatPane.tsx:11516-11523` | `toggleMembersSidePanel`（11331-11355） | 开关右侧独立面板 |
| 侧栏渲染 | `ChatPane.tsx:12393-12406`（宽）/`12542-12557`（窄 overlay） | — | 独立占位列 / 浮层 |
| 工作台 tab 体系 | `desktop/src/components/work-panel/WorkPanel.tsx` | `WorkPanelTabKind`（379-385）、`WorkPanelFocus`（389-411）、`openGraphTab`（1165-1176）、plus 菜单（1372-1423）、`startEntries`（1425-1454）、graph tab 渲染（1534+、1958-1963） | 「运行图」是最贴近的同构范例 |
| 工具名清洗 | `desktop/src/components/messages/tool-display-name.ts` | `formatToolDisplayName` | 复用，勿重写 |

## In scope / Out of scope

**In scope**

- 新增 span 派生模块 + Execution Timeline 甘特组件（工作台 tab）。
- 删除 `MemberActivityList` 及其在成员侧栏的挂载。
- 群成员管理 UI（头像网格 / 加成员 / 移出成员）从独立右侧面板搬进 WorkPanel 成员 tab。
- 顶栏 `Users` 按钮语义改为「打开工作台成员 tab」。

**Out of scope（严禁顺手做）**

- 不做 G-002：不落盘 JSONL Trace、不加服务端 analyze 接口、不做重启后回看。
- 不做 G-003 token/成本 Overall 卡。
- 不改 `agenticx/` 任何 Python 文件（本次纯前端；现有 SSE 字段已够用）。
- 不动 `group_blocked`、不把工具进度重新写回消息流。
- 不改 RunGraph 的 DAG 语义（时间线与运行图并存，不互相替代）。
- 不引入新 npm 依赖（甘特用 div + CSS，对齐上游做法）。
- 不删除 store 中的 `membersPanelOpen` / `sidePanelTab` 字段（localStorage 旧快照兼容），仅停止用它控制可见性。

## FR / AC

### FR-1 span 派生：`ToolStep[]` → `ToolSpan[]`

新建 `desktop/src/components/graph/span-derive.ts`：

```ts
export type ToolSpan = {
  callId: string;
  toolName: string;
  startMs: number;
  /** 未闭合（phase=calling）时为 undefined —— 对齐上游 TraceToolSpan.outputTs 语义 */
  endMs?: number;
  running: boolean;
};

export type TimelineWindow = { startMs: number; endMs: number };

export function deriveToolSpans(steps: ToolStep[]): ToolSpan[];
/** nowMs 用于给未闭合 span 收口，便于测试注入 */
export function deriveTimelineWindow(spans: ToolSpan[], nowMs: number): TimelineWindow | null;
```

规则（逐条照做，勿自行推断）：

- `startMs = step.startedAt`；`phase === "done"` 时 `endMs = step.updatedAt`，`running = false`；`phase === "calling"` 时 `endMs = undefined`，`running = true`。
- `startedAt` 或 `updatedAt` 非有限数（`Number.isFinite` 为 false）→ **跳过该 span**（对齐上游 `msOf` 的 NaN 不传播原则）。
- `endMs < startMs` 时钳到 `startMs`（时钟回拨保护）。
- 输出按 `startMs` 升序；`startMs` 相同则按原数组顺序稳定排序（勿用不稳定比较）。
- `deriveTimelineWindow`：`startMs = min(所有 startMs)`；`endMs = max(已闭合的 endMs ∪ {nowMs 若存在 running span})`；`spans` 为空返回 `null`；window 跨度为 0 时返回 `endMs = startMs + 1000`（避免除零）。

**AC-1**：新增 `desktop/src/components/graph/span-derive.test.ts`（vitest），至少断言：

1. calling → done 合并为一条闭合 span，`endMs` 取 done 的 `updatedAt`。
2. 两条时间重叠的 span 各自保留（区间相交，不被合并）。
3. `startedAt = NaN` 的 step 被跳过。
4. 存在 running span 时 `deriveTimelineWindow(spans, nowMs).endMs === nowMs`。
5. 空数组 → `deriveTimelineWindow` 返回 `null`。

### FR-2 Execution Timeline 甘特组件

新建 `desktop/src/components/graph/ExecutionTimeline.tsx`，导出 `ExecutionTimeline`：

```tsx
type Props = {
  paneId: string;
  /** 成员顺序：["__meta__", ...group.avatarIds]，与成员 tab 一致 */
  agentIds: string[];
  avatarById: Map<string, Avatar>;
  metaLeaderLabel?: string;
  /** 与运行图/成员选中联动（可选） */
  selectedAgentId?: string | null;
  onSelectAgent?: (agentId: string) => void;
};
```

数据源：`useGraphRunStore((s) => s.byPane[paneId]?.toolStepsByNode ?? EMPTY_PANE_GRAPH_STATE.toolStepsByNode)`（沿用 `MemberActivityList.tsx:137-139` 的读法，含 `EMPTY_PANE_GRAPH_STATE` 稳定兜底），节点 id 规则沿用 `agent:<avatarId>`（`nodeIdForAgent`，从被删组件移植到 `span-derive.ts` 或本文件，勿重复实现两份）。

布局与交互（从上游 `TimelineChart` 迁移的**不变量**，不是逐行抄代码）：

- 左侧 sticky 标签列：宽 `5.5rem`、不透明背景、与行等高，横向缩放时不随内容滚走。
- 每个成员一个分组；分组内每个 `callId` 一行（row = 一个工具 span），行标签用 `formatToolDisplayName(toolName)`。
- 色条：执行中/已完成用两种固定色（进行中带脉冲动画，已完成实心）；本期**无审批等待、无 thinking/text 车道**（无对应 SSE），故仅两类，不留空车道。
- 缩放/平移：图下方一条滑块，拖拽主体平移、拖两端缩放、双击复位；**禁用滚轮缩放**（避免页面滚动误触）。缩放范围 `0.25x – 24x`。
- 高亮：hover 某条 → **淡出其余**（不用描边）；点击某条 → `onSelectAgent(agentId)`。
- 未闭合 span 右端跟随 1s 心跳走（复用 `useLiveToolElapsedSeconds` 或本地 `setInterval(1000)`，勿更高频）。
- 空态：`spans` 为空显示「本轮尚无工具调用」，不渲染空坐标轴。
- 主题：只用 `bg-surface-*` / `text-text-*` / `--border*` 等主题 token；**禁止硬编码十六进制色**（与 `TerminalEmbed` 的历史教训一致）。

**AC-2**：

1. 群聊中让同一分身连续调用 ≥3 个工具，工作台「执行时间线」出现 ≥3 条色条，先后关系与调用顺序一致，进行中那条右端持续增长。
2. 拖动滑块可缩放/平移；双击复位；滚轮**不**改变缩放。
3. hover 一条色条时其余淡出；点击后成员 tab / 运行图选中态同步（若 `onSelectAgent` 已接线）。
4. 无工具调用的会话显示空态文案，控制台无 NaN / key 重复告警。

### FR-3 删除「成员活动」

- 删除文件 `desktop/src/components/graph/MemberActivityList.tsx`。
- 删除 `ChatPane.tsx:43` 的 import 与 `2335-2340` 的 `<MemberActivityList … />` 渲染块。
- 若 `MemberRow` 内的 `useLiveElapsedSeconds` 在别处无引用，随文件一起删除；`formatToolDisplayName`、`nodeIdForAgent` 等被时间线复用的逻辑先迁走再删文件。

**注意**：只删这一个组件与其挂载点；`toolStepsByNode` / `applyToolStep` / `tool-steps.test.ts` **保留**（时间线依赖它们）。

**AC-3**：`rg "MemberActivityList" desktop/src` 无结果；`npm run typecheck`（desktop）通过；群成员区不再出现「成员活动」标题与竖列表。

### FR-4 群成员管理搬进工作台 tab

1. `WorkPanel.tsx` 扩展 tab 体系（照 `graph` 的模式逐处对齐，勿只改一半）：
   - `WorkPanelTabKind`（379-385）加 `"members"` 与 `"timeline"`。
   - `WorkPanelFocus`（389-411）加 `{ kind: "members" }` 与 `{ kind: "timeline" }`。
   - 新增 `membersTabOpen` / `timelineTabOpen` state（对齐 `graphTabOpen`，697）与 `openMembersTab` / `closeMembersTab` / `openTimelineTab` / `closeTimelineTab`（对齐 1165-1176）。
   - `hasAnyTab`（870-876）与 `resolveFallbackKind`（885-891）纳入这两个 kind。
   - plus 菜单（1372-1423）加两项：`成员`（lucide `Users`）、`执行时间线`（lucide `GanttChartSquare`，若图标不可用退 `BarChart3`）；`startEntries`（1425-1454）同步加卡片，副标题分别为「查看与增删群成员」「按时间轴查看各成员的工具执行过程」。
   - tab 条与内容区渲染照 1534+ / 1958-1963 的 graph 分支写法补两个分支。
2. 群成员管理 UI 从 `ChatPane.tsx:2044` 的 `GroupMembersSidePanel` 抽出为 `desktop/src/components/work-panel/MembersTabPanel.tsx`：保留搜索框、头像网格、`+ 添加成员` / `− 移出成员` 与添加成员模态；**去掉**面板级关闭按钮（`PanelRightClose`，2213-2221 那段）与 `onClose` prop——tab 由 tab 条的 ✕ 关闭。原 `GroupMembersSidePanel` 删除。
3. WorkPanel 需要的新 props：`groupId?: string | null`、`avatarList: Avatar[]`（由 `ChatPane` 现有 `groupChatId` / `avatars` 传入，两处 `<WorkPanel …>` 调用点 12433+ 与 12589+ **都要传**，勿漏窄屏那份）。非群聊 pane（`groupId` 为空）时 plus 菜单与 `startEntries` 不显示「成员」项。
4. 顶栏 `Users` 按钮（11516-11523）语义改为：`openWorkspaceSidebarForPane(...)` + `setWorkPanelFocus({ kind: "members" })`；`title` 改为「群成员」。删除 `toggleMembersSidePanel`（11331-11355）、`closeMembersPanelOnly`（11216-11220）、以及 12393-12406 / 12542-12557 两处独立面板渲染；`compactSidePanels` 互斥逻辑（11114-11173）中移除 `membersPanelOpen` 分支与 `keep === "members"`。
5. `store.ts` 的 `membersPanelOpen` / `sidePanelTab` 字段与 `cycleSidePanel` / `openSidePanel` 的 `"members"` 分支**保留不动**（旧 localStorage 兼容），只是不再有调用方；`ChatPane` 内其余把 `membersPanelOpen: false` 写进 reset 对象的位置（490-496、11183-11189、11245-11251、11298-11304 等）保持原样即可。

**AC-4**：

1. 群聊 pane 顶栏点 `Users` → 工作台打开并激活「成员」tab，显示头像网格；`+ / −` 增删成员仍生效（保存失败仍弹错误文案，不静默）。
2. 右侧不再出现独立群成员面板；窄窗格 overlay 模式也不再有该浮层。
3. plus 菜单（+）中「成员」「执行时间线」与「任务摘要 / 浏览器 / 运行图 / 终端 / 工作区」并列；非群聊 pane 不出现「成员」。
4. tab 条上两个新 tab 可 ✕ 关闭，关闭后回退到其它已开 tab，不出现空白工作台。
5. `npm run typecheck` + `npm run test`（desktop vitest）全绿。

## 实施顺序

1. FR-1 span-derive + 测试（纯函数，先绿）。
2. FR-2 `ExecutionTimeline`（先只接一个成员，跑通再补多成员分组与缩放）。
3. FR-4 WorkPanel tab 体系 + `MembersTabPanel` 搬迁 + 顶栏按钮改语义。
4. FR-3 删 `MemberActivityList`（放最后，确保时间线已可用，避免中间态无任何私活视图）。

## 回归门槛

- `desktop`：`npm run typecheck`、`npm run test`（含既有 `tool-steps.test.ts`、`tool-display-name` 测试）。
- 手工：群聊多工具轮次 → 时间线正确；消息流**仍无**逐工具进度气泡；运行图 / 终端 / 工作区 / 任务摘要 / 浏览器 五个既有 tab 行为不变；窄窗格与宽窗格各验一次。
- 不需要跑 `agx serve` 冷启动（本次不碰 Python；若最终 diff 里出现 `agenticx/` 改动，说明越界，需回退）。

## 风险与回滚

| 风险 | 缓解 | 回滚 |
|------|------|------|
| 长会话色条过密 | 缩放 + 每成员分组折叠 | 时间线 tab 可关闭，不影响主流程 |
| 无 Model 车道显得信息少 | 本期只画工具车道，不留空车道；Model 车道待后续 SSE | — |
| 搬迁 `GroupMembersSidePanel` 丢功能 | 逐项核对搜索 / 网格 / 加减 / 模态四块 | git revert 该 commit |
| 旧 localStorage 快照带 `membersPanelOpen: true` | 字段保留但不再控制渲染，天然失效 | — |
| 大文件（`ChatPane.tsx` 12k+ 行）整段替换误删无关代码 | 严格按行号精确增删，改后逐行 diff 复核 | 参照 `server.py` 事故教训 |
