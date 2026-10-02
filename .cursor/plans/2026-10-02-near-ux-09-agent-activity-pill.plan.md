# Near-UX-09：输入框上方「智能体正在执行」状态胶囊

Planned-with: Claude Sonnet 5.5
Suggested-Impl-Model: Composer 2.5（纯前端；汇总函数 + 小组件）
Plan-Id: 2026-10-02-near-ux-09-agent-activity-pill
Plan-File: `.cursor/plans/2026-10-02-near-ux-09-agent-activity-pill.plan.md`
Source: OpenMuse「Computer · take control」常驻状态胶囊（`research/codedeepresearch/openmuse/`，UI 对照，非代码引入）

## Goal
本窗格有子智能体在跑/待确认/待输入时，在输入框上方显示一枚胶囊：「N 个子智能体运行中 · M 个待你确认」，点击打开工作区面板（子智能体列表所在）。让用户一眼知道"现在谁在动手、有没有卡在等我"。

## 现状证据
- `ChatPane.tsx`：`paneSubAgents`（≈L3930）已按 `pane.sessionId` 过滤；`SubAgentStatus` 见 `store.ts` L85（pending/awaiting_confirm/awaiting_input/running/paused/completed/failed/cancelled）。
- 打开工作区侧栏：`cycleSidePanel(pane.id, "workspace")`（≈L13951 `toggleWorkspaceSidePanel`）。
- 无任何全局汇总入口。

## 改动
1. 新建 `desktop/src/utils/agent-activity.ts`：`summarizeAgentActivity(subAgents: Pick<SubAgent,"status">[]) => { running: number; awaitingConfirm: number; awaitingInput: number; active: number }`。`running` 统计 `running|pending`；`active = running + awaitingConfirm + awaitingInput`。
2. 新建 `desktop/src/components/AgentActivityPill.tsx`：props `{ summary; onOpen }`；`active===0` 返回 null；有待确认时用 `--status-warning` 色，否则中性；左侧三点脉冲（复用 `agx-dot-pulse` 类），文案走 i18n。
3. `ChatPane.tsx`：在输入框容器上方（紧邻 `favoriteToastOpen` Toast 之后，约 L14442–14452 之间）只增一段 `{!liftComposer && !isGroupPane ? <AgentActivityPill summary={...useMemo(summarizeAgentActivity(paneSubAgents))} onOpen={toggleWorkspaceSidePanel}/> : null}`。群聊窗格已有成员活动展示，本期不改。
4. i18n：`desktop/locales/{zh,en}/chat.json` 新增 `"activity": { "running": "{{count}} 个子智能体运行中", "awaiting": "{{count}} 个待你确认", "input": "{{count}} 个等待你的输入", "open": "查看" }`。

## Out of scope
一键全停、Claude Code 桥接/定时任务汇总、群聊、改 SubAgent 数据流。

## AC
- `desktop/src/utils/agent-activity.test.ts`：各状态组合计数正确；completed/failed/cancelled 不计入；空数组 `active===0`。
- `npx tsc --noEmit` 对新文件无报错。
