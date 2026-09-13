# 长程任务回放 02：Desktop 执行回放工作台

Planned-with: gpt-5.6-sol-medium

Suggested-Impl-Model: cursor-grok-4.6-xhigh-fast

Status: pending

Plan-Id: 2026-09-10-long-run-replay-02-desktop-replay

Parent-Plan: `.cursor/plans/pending/2026-09-10-long-run-replay-branching-master.plan.md`

Depends-On: `.cursor/plans/pending/2026-09-10-long-run-replay-01-event-ledger.plan.md`

## Goal

把 WorkPanel 现有“执行时间线”升级为所有 session 可用的只读执行回放工作台：能播放、暂停、拖动、筛选、查看第 N 步详情，并能一键复制给人或其他 Agent 使用的结构化回顾。打开、播放和拖动回放都不得触发 LLM 或工具执行。

## Architecture

保留 `WorkPanel` 已有 `timeline` tab 和开关逻辑，不新增一套右侧面板状态。将当前只依赖内存 Graph tool spans 的 `ExecutionTimeline` 替换为 ledger 驱动的 `RunReplayPanel`：

- run 选择和摘要来自 `GET /api/runs?session_id=...`；
- 事件分页来自 `/api/runs/{run_id}/events`；
- 运行中的 run 每 2 秒从最后 `seq` 增量拉取；
- 已完成 run 不轮询；
- 播放只改变前端 `cursorSeq`；
- 详情按需获取 payload，避免首次打开下载全部大结果；
- Graph store 继续作为 running run 的即时 live overlay：按 `toolCallId` 覆盖尚未刷入 ledger 的进行中 span；overlay 不分配历史 seq、不持久化、不可作为分叉点。冷重启和历史回放仍只信 ledger。

现有 `ExecutionTimeline` 的甘特布局、`span-derive.ts` 与测试不得删除。`RunReplayPanel` 可以复用其 lane/span 子组件，或在 ledger 不可用但 Graph 尚有 live tool steps 时完整渲染旧组件。这样本计划扩展“可跨重启回放”，不会倒退已经交付的群聊实时工具跨度体验。

## In scope

- WorkPanel timeline tab 对所有 Meta、分身、群聊 session 可见。
- run 列表、摘要指标、多 lane 事件时间线、播放控制、筛选、详情。
- 已完成与运行中 run。
- 确定性 Markdown 回顾复制。
- ledger gap / legacy session / no-run 的诚实空态。
- 100+ 工具步骤的分页与定位。

## Out of scope

- 分叉操作；由 03 子规划实现。
- 修改聊天消息列表或聊天气泡。
- 自动调用模型生成总结。
- 编辑或删除 ledger 事件。
- 用 Graph 数据补造旧历史。
- Enterprise UI。

## Exact files

Create:

- `desktop/src/components/replay/replay-types.ts`
- `desktop/src/components/replay/replay-api.ts`
- `desktop/src/components/replay/replay-projection.ts`
- `desktop/src/components/replay/replay-store.ts`
- `desktop/src/components/replay/RunReplayPanel.tsx`
- `desktop/src/components/replay/ReplaySummaryBar.tsx`
- `desktop/src/components/replay/ReplayTimeline.tsx`
- `desktop/src/components/replay/ReplayControls.tsx`
- `desktop/src/components/replay/ReplayEventDetail.tsx`
- `desktop/src/components/replay/replay-projection.test.ts`
- `desktop/src/components/replay/replay-store.test.ts`
- `desktop/src/components/replay/RunReplayPanel.test.tsx`

Modify:

- `desktop/src/components/work-panel/WorkPanel.tsx`
  - import 区：`ExecutionTimeline` 改为 `RunReplayPanel`；
  - `activeKind === "timeline"` 渲染段，约 L2492–2499；
  - timeline tab label/icon 保留现有位置，文案改成“执行回放”。
- `desktop/locales/zh/workspace.json`
- `desktop/locales/en/workspace.json`
- `desktop/src/components/graph/ExecutionTimeline.tsx`
  - 不删除；抽取可复用 lane/span 视图，或作为 running/no-ledger fallback。

不要修改 `ChatPane.tsx` 大段消息渲染。WorkPanel 已有 timeline tab，直接复用。

## FR-1: strict frontend contracts

`replay-types.ts`：

```typescript
export type RunStatus =
  | "running"
  | "completed"
  | "failed"
  | "cancelled"
  | "interrupted";

export type EffectClass =
  | "none"
  | "read"
  | "local_write"
  | "external_write"
  | "unknown";

export type ReplayRun = {
  runId: string;
  sessionId: string;
  turnId: string;
  agentId: string;
  status: RunStatus;
  createdAt: number;
  completedAt?: number;
  eventCount: number;
  completeness: "complete" | "partial";
  parentRunId?: string;
  forkedFromEventId?: string;
};

export type ReplayEvent = {
  eventId: string;
  runId: string;
  seq: number;
  ts: number;
  type: string;
  agentId: string;
  roundIdx?: number;
  toolCallId?: string;
  parentEventId?: string;
  title: string;
  summary: string;
  effectClass: EffectClass;
  branchable: boolean;
  unbranchableReason?: string;
  payload?: Record<string, unknown>;
  payloadRef?: string;
};
```

所有 API 解析从 `unknown` 开始，通过纯函数 normalize；禁止 `any` 和直接断言整包响应。

AC:

- 缺失可选字段可读；
- 非法 seq、空 event id 的行被跳过并产生 `parseWarnings`；
- 未知 status 映射为 `interrupted` 只用于展示，不回写后端；
- 未知 effect 映射 `unknown`。

## FR-2: replay API client

`replay-api.ts` 提供：

```typescript
listReplayRuns(apiBase, apiToken, sessionId)
getReplayRun(apiBase, apiToken, runId)
listReplayEvents(apiBase, apiToken, runId, options)
getReplayExport(apiBase, apiToken, runId, format)
```

要求：

- 使用 `AbortSignal`；
- URL 参数统一 `URLSearchParams`；
- 非 2xx 解析后端 `detail/code`，形成用户可读错误；
- events 支持 `afterSeq/limit/types/includePayload`；
- 不走 Electron 新 IPC；复用 renderer 已有 `apiBase/apiToken` 模式，与 `useGraphRun.ts` 一致。

AC:

- URL 编码 session/run id；
- abort 不写 error banner；
- 401/409/500 显示后端 detail；
- events 返回 `nextSeq/hasMore`。

## FR-3: pure projection

`replay-projection.ts` 只做纯数据计算：

```typescript
projectReplay(events: ReplayEvent[]): ReplayProjection
visibleEventsAtCursor(events: ReplayEvent[], cursorSeq: number): ReplayEvent[]
groupEventsIntoLanes(events: ReplayEvent[]): ReplayLane[]
summarizeRun(events: ReplayEvent[]): ReplayStats
resolveReplayDuration(events: ReplayEvent[]): number
```

投影规则：

- lane 顺序：`meta` 第一，其余按首次出现 seq；
- TOOL_CALL 与 TOOL_RESULT 都保留，但时间轴视觉上由相同 `toolCallId` 合并为一个 span；
- 无 result 的调用显示 running / interrupted，不伪造完成；
- confirm required 到 response 合并为等待 span；
- ERROR、ledger gap 永远可见，不受普通筛选隐藏；
- `cursorSeq` 只显示 `seq <= cursorSeq` 的状态；
- 同 seq 不允许；若 API 数据重复，按 event id 去重并记录 warning。

AC:

- 100 个 tool call/result 合成 100 个 span；
- 跨 agent 正确分 lane；
- 缺 result 的 tool span 标 interrupted；
- cursor 在 101 时不显示 102；
- gap 不会被“仅工具”筛选隐藏。

## FR-4: replay state machine

`replay-store.ts` 使用独立 Zustand store，按 pane id 隔离：

```typescript
type ReplayPlaybackState = {
  runId: string | null;
  events: ReplayEvent[];
  cursorSeq: number;
  selectedEventId: string | null;
  playing: boolean;
  speed: 0.5 | 1 | 2 | "instant";
  filters: Set<string>;
  loading: boolean;
  loadingMore: boolean;
  hasMore: boolean;
  error: string | null;
};
```

状态机：

- 打开 run：reset → load first page → cursor=first seq；
- 点击播放：按相邻事件 `ts` 差值 / speed 调度，单次等待 clamp 到 80..1500ms；
- `instant` 每 animation frame 推进最多 100 条，避免锁 UI；
- 手动拖动立即 pause；
- 切 session / run 必须取消旧 fetch 和 timer；
- 完成时 cursor=last seq、playing=false；
- 关闭 tab 清 timer，不清已加载 cache；
- cache key = `sessionId/runId`，上限保留最近 5 个 run。
- running run 同时读取 `useGraphRunStore` live steps；只按相同 `toolCallId` overlay，不把 Graph 时间戳写回 ledger state。

AC:

- timer 使用 fake timers 验证 0.5/1/2/instant；
- drag 后停止自动推进；
- 切 run 后旧请求返回不污染新 run；
- 两个 pane 的播放状态互不影响；
- 组件卸载无残留 timer。
- live overlay 消失或重启后，历史事件和 cursor 不丢失。

## FR-5: summary and run picker

`ReplaySummaryBar`：

- run 下拉按 `createdAt` 倒序；
- 默认选择最新 running run，否则最新 completed run；
- 展示：
  - 状态；
  - 总耗时；
  - 轮次数；
  - 工具调用数；
  - 错误数；
  - 子智能体数；
  - 分支数；
- `completeness=partial` 显示黄色“记录不完整”，不可用绿色成功态掩盖。

不要把所有指标做成一排厚重卡片；使用紧凑文本与少量状态 chip。

AC:

- running run 优先；
- partial 永久显示；
- 只有一个 run 时不显示无意义下拉箭头；
- 指标从事件投影计算，不信任前端随机计数。

## FR-6: timeline and controls

`ReplayTimeline`：

- 顶部横向 overview scrubber；
- 主区为纵向事件列表 + agent lane 标记，不画复杂 DAG；
- 每行显示 `#seq`、相对时间、主体、标题、状态、持续时间；
- tool 参数/结果默认折叠；
- 当前 cursor 行使用背景层级强调，不使用粗白边框；
- 点击行选择并暂停；
- 支持键盘：
  - Space 播放/暂停；
  - ArrowLeft / ArrowRight 上一步/下一步；
  - Home / End 首尾；
- 所有按键在输入框聚焦时不拦截。

`ReplayControls`：

- 播放/暂停；
- 前一步/后一步；
- speed；
- 事件筛选：全部、工具、Agent、等待、错误、产物；
- “复制回顾”；
- 不显示“重新执行”按钮。

100–500 条已加载事件直接渲染；不新增 virtualization 依赖。超过 500 使用“加载更多”，保持当前 cursor 锚点。

AC:

- 打开面板不调用任何 POST；
- 播放期间 API 只有 GET；
- keyboard controls 通过 jsdom 测试；
- 500 条渲染无 key warning；
- load more 后 seq 连续且 cursor 不跳。

## FR-7: event detail

`ReplayEventDetail` 复用现有视觉语义：

- 工具详情参考 `ToolCallCard` 的折叠层级和 `formatToolDisplayName`；
- reasoning 参考 `ReasoningBlock`，但只读且不显示 streaming spinner；
- artifact 路径复用 workspace preview 入口；
- sub-agent 引用可打开现有 `SubAgentRunDrawer`；
- payload 未加载时点击“查看完整输入/结果”才请求 `include_payload=true` 的单页；
- 显示 effect class：
  - read：中性；
  - local write：蓝/主题色；
  - external write：黄色；
  - unknown：黄色问号语义；
- 禁止渲染 raw HTML。

AC:

- payload lazy load 仅一次并缓存；
- tool result 大文本保留换行且最大高度可滚动；
- artifact 点击沿用现有安全路径预览；
- unknown effect 有明确中文解释。

## FR-8: deterministic review copy

点击“复制回顾”：

1. 调 `/export?format=markdown&redact=true`；
2. `navigator.clipboard.writeText`；
3. 按钮附近显示一次“已复制回顾”，1.6 秒消失；
4. API 失败显示就近错误，不用全局右下角 toast；
5. 不允许前端用当前过滤结果自行拼出不完整摘要。

AC:

- 复制内容来自后端；
- 默认 URL 明确 `redact=true`；
- 连点只显示一个反馈；
- clipboard 拒绝时显示错误。

## FR-9: WorkPanel integration

修改 `WorkPanel.tsx`：

Before：

```tsx
{activeKind === "timeline" ? (
  <ExecutionTimeline
    paneId={paneId}
    agentIds={timelineAgentIds}
    avatarById={timelineAvatarById}
  />
) : null}
```

After intent：

```tsx
{activeKind === "timeline" && timelineTabOpen ? (
  <RunReplayPanel
    paneId={paneId}
    sessionId={sessionId}
    apiBase={apiBase}
    apiToken={apiToken}
    avatarById={timelineAvatarById}
    onOpenSubagentRun={...existing drawer action...}
    onOpenArtifact={...existing preview action...}
  />
) : null}
```

约束：

- 无 `groupId` 也可以打开；
- sessionId 为空时显示“发送首条消息后可回放执行过程”；
- legacy session 无 ledger 时显示“该会话创建于执行回放启用之前，可查看聊天记录，但没有完整步骤账本”；
- 当前 running run 增量刷新；
- running run 保留现有 Graph SSE 的即时工具 span，ledger 到达后按 `toolCallId` 去重收敛；
- 不改 summary/workspace/graph/terminal/browser tabs 行为。

## Localization

`workspace.json` 新增 `replay.*` 命名空间。中文为主，英文完整覆盖。至少包含：

- 执行回放
- 播放 / 暂停
- 上一步 / 下一步
- 即时
- 复制回顾
- 已复制回顾
- 记录不完整
- 外部写入
- 未知副作用
- 该节点不可分叉
- 旧会话没有完整运行账本

本子规划先提供“该节点不可分叉”详情占位，03 完成后才出现操作按钮。

## Verification

运行：

```bash
cd desktop
npx vitest run \
  src/components/replay/replay-projection.test.ts \
  src/components/replay/replay-store.test.ts \
  src/components/replay/RunReplayPanel.test.tsx \
  src/components/replay/replay-dom.test.tsx \
  src/components/graph/span-derive.test.ts \
  src/components/graph/tool-steps.test.ts \
  src/components/graph/graph-types.test.ts \
  src/components/subagent/run-activity-timeline.test.ts \
  src/i18n/message-parity.test.ts
npm run build
```

说明：仓库当前没有 `npm run typecheck` script；直接运行全量 renderer `tsc`
会命中与本计划无关的既有类型错误，因此仅作为非阻塞已知基线记录，不得声称其通过，
也不在本计划内修改 package scripts 或修复全仓类型。

再启动现有 Desktop dev server，用一条包含至少 20 个工具步骤、一次失败、一次确认、一个子智能体的 fixture/session 手工验收：

- timeline tab 打开后默认选最新 run；
- 播放/暂停/拖动工作；
- 工具和子智能体 lane 顺序正确；
- 重启应用后仍可回放；
- 复制回顾已脱敏；
- Network 面板无 replay POST；
- 聊天列表滚动和 streaming 不受影响。

修改多个 TSX 后按 React checklist 检查：

- effect cleanup；
- stable Zustand selectors；
- button aria-label；
- keyboard focus；
- 无 `any`；
- 无匿名 Fragment key；
- light/dim/dark 三态可读。

## Done definition

- 用户能从 WorkPanel 打开任意新会话的执行回放；
- 100+ 工具步骤可定位到明确 `#seq`；
- 回放完全只读；
- 其他 Agent 可消费复制出的确定性 Markdown；
- partial/legacy 状态不伪装完整；
- 上述定向 Vitest 与 Desktop build 全绿；全量 renderer `tsc` 维持非阻塞既有基线。
