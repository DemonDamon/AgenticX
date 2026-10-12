# 子计划 08：Desktop 演进中心与证据链

Planned-with: GPT-5.6 Sol
Suggested-Impl-Model: cursor-grok-4.6-xhigh-fast
Parent-Plan: `.cursor/plans/pending/2026-09-09-near-personal-agent-control-plane-master.plan.md`
Depends-on: `2026-09-09-near-personal-control-01-run-ledger`, `2026-09-09-near-personal-control-03-observation-ledger`, `2026-09-09-near-personal-control-05-user-constitution`, `2026-09-09-near-personal-control-06-skill-eval-gate`
Plan-Id: 2026-09-09-near-personal-control-08-evolution-center

> **For implementer:** 使用 executing-plans。该计划是现有组件聚合与缺失入口接线，不是视觉重塑。后端未提供的数据禁止 mock。

**Goal:** 让用户在一个中文、三态主题一致的入口查看委派证据、会话健康度、偏好/技能待批准项，并能进入现有详情与回滚流程。

**Architecture:** 新增 Settings「演进中心」Tab，组合现有 PendingProposalsList、LoopReviewCard、SubAgentRunDrawer 与后端真实数据；先接线 drawer 和当前会话健康度，再聚合待审 inbox。跨 pane 状态仍用 Zustand。

**Tech Stack:** React、Zustand、Electron preload、i18next、Vitest。

## 现有基础

- `PendingProposalsList` 已接技能 approve/reject。
- `LoopReviewCard` 已在历史侧栏使用，当前 ChatPane 无入口。
- `SubAgentRunDrawer` 已挂到 ChatPane，但 `openRunDrawer` 没有 UI 调用链。
- run detail/activity/artifact 和 cluster API 已存在。

## In scope

- drawer 入口、当前会话体检 chip。
- 新 evolution Settings Tab。
- 委派、健康度、技能/偏好真实 pending 聚合。
- 空态、错误、loading、toast。

## Out of scope

- 新 Design System、顶栏重构、后端评测算法。
- Avatar Portfolio UI（计划 09）。
- 假造偏好/评测/分身数据。

## FR-08-1：接通 Run Drawer

**Files:**
- Modify: `desktop/src/components/subagent/SubAgentClusterCard.tsx`
- Modify: `desktop/src/components/SpawnsColumn.tsx`
- Modify: `desktop/src/components/ChatPane.tsx::openSubAgentDetailFromCluster`
- Modify/Test: `desktop/src/store.ts` 与对应 store test

要求：点击 persisted run 调 `openRunDrawer(paneId, runId)`；live-only spawn 保持现有 pane 行为。drawer 与 workspace/memory side panel 互斥规则保持。run 不存在显示就近错误，不打开空 drawer。

## FR-08-2：当前会话体检

**Files:**
- Create: `desktop/src/components/session/LoopReviewScoreChip.tsx`
- Modify: `desktop/src/components/ChatPane.tsx` 状态 chips 区
- Test: `desktop/src/components/session/LoopReviewScoreChip.test.tsx`

要求：
- 复用 `getSessionLoopReview` 与 `LoopReviewCard`。
- 与 `sessionHealth` stall 指标分开命名：前者“会话体检”，后者仍是运行异常。
- 无 review 时中性空态，不显示失败/已中断。

## FR-08-3：Settings Tab 注册

**Files:**
- Modify: `desktop/src/settings-tab.ts`
- Modify: `desktop/src/settings-tab.test.ts`
- Modify: `desktop/src/components/SettingsPanel.tsx::TAB_DEFS/content switch`
- Create: `desktop/src/components/settings/evolution/EvolutionCenterTab.tsx`
- Modify: `desktop/locales/zh/settings.json`、英文 locale

Tab id=`evolution`，中文“演进中心”。不得破坏 `SecurityCenterTab` 持续挂载和底部权限 flush/save。

## FR-08-4：真实数据聚合

EvolutionCenterTab 三块：

1. **待你批准**
   - 复用技能 PendingProposalsList。
   - Constitution pending 调计划 05 API。
   - 无对应 API 时显示“尚未启用”，不是样例卡。
2. **委派证据链**
   - 当前会话 clusters/run ledger。
   - 点击打开 ChatPane 对应 drawer；若当前设置页无法直接定位 pane，先 deep-link 回 pane 再打开。
3. **会话健康度**
   - 当前 pane/session review；提供进入历史会话详情。

**Files:**
- Create: `desktop/src/components/settings/evolution/evolution-center.ts`（纯聚合 helper）
- Test: `.../evolution-center.test.ts`
- Modify preload/global types 仅当现有 API 缺封装。

## FR-08-5：交互与主题

- 使用 `Panel`、`Button`、`Toast`、`ConfirmDialog`。
- 语义 token：`bg-surface-card/text-text-strong/border-border/--ui-btn-primary-*`。
- dark/dim/light 都可读，禁止硬编码背景。
- approve/reject/rollback 立即反馈；失败保留对话并展示底层错误。
- 所有过程事件聚合在折叠证据链，不发多条聊天气泡。

中文 key：`tabs.evolution`、`evolution.pendingTitle/delegationTitle/healthTitle/viewRun/evidenceFrom/empty/error`；复用既有 `loopReview.*`、`skillsPending.*`、`subagentDrawer.*`。

## 验证

```bash
cd desktop
npm test -- --run \
  src/settings-tab.test.ts \
  src/components/settings/evolution/evolution-center.test.ts \
  src/components/session/LoopReviewScoreChip.test.tsx \
  src/components/subagent/run-activity-timeline.test.ts
npm run typecheck
```

人工三态验收：
- 点击消息/Spawns run 能打开正确 drawer。
- Settings 演进中心真实 pending 计数一致。
- 无 review/无 run/后端失败均有正确空态。
- 其他 Settings Tab 保存与 security flush 不倒退。

## 成本拆分

便宜模型可做 i18n、Tab ID、纯 helper/tests；Grok 4.6 负责 ChatPane/store/SettingsPanel 跨 surface 收口。不要为了省成本让便宜模型重写 `ChatPane.tsx` 大段。
