# Near-UX-08：Pro 聊天空态 Quick Start 任务卡

Planned-with: Claude Sonnet 5.5
Suggested-Impl-Model: Composer 2.5（纯前端、单组件）
Plan-Id: 2026-10-02-near-ux-08-empty-quick-start
Plan-File: `.cursor/plans/2026-10-02-near-ux-08-empty-quick-start.plan.md`
Source: Octop 空态 Quick Start 六宫格（`research/codedeepresearch/Octop/`，UI 对照，非代码引入）

## Goal
Pro 窗格无消息时，品牌字标下方给出 6 张可点任务卡；点击把预置提示词填入输入框并聚焦（**不自动发送**），降低新手空白焦虑。

## 现状证据
- `desktop/src/components/ChatPane.tsx`：`isBrandEmptyState`（≈L14049）、`liftComposer` 块（≈L14464 `<NearBoxHero size={160} />`）。无任务卡。
- Lite 模式仅有 `QuickActions` 小胶囊（`ChatView.tsx` L2938），Pro 没有。
- `setComposerText`（≈L5485）与 `focusComposerEnd`（≈L5038）已存在。

## 改动
1. 新建 `desktop/src/components/brand/QuickStartCards.tsx`：props `{ onPick: (prompt: string) => void }`，6 张卡（id: summarize / weekly / minutes / explainCode / plan / translate），每张 title + 一行 desc，`grid-cols-2 md:grid-cols-3`，主题 token 样式（`bg-surface-card` / `border-border` / hover `bg-surface-hover`），不用硬编码色。
2. 新建 `desktop/src/components/brand/quick-start-items.ts`：导出 `QUICK_START_IDS` 常量。
3. `ChatPane.tsx` 仅在 `liftComposer` 块里 `<NearBoxHero/>` 之后、`isAutomationTaskPane` 错误块之前，条件 `!isGroupPane && !isAutomationTaskPane` 渲染 `<QuickStartCards onPick={(p) => { setComposerText(p); requestAnimationFrame(focusComposerEnd); }} />`。**只增行，不改其它。**
4. i18n：`desktop/locales/{zh,en}/chat.json` 顶层新增 `"quickStart": { "<id>": { "title", "desc", "prompt" } }`（不动已有键）。

## Out of scope
自动发送、Lite 改造、群聊/自动化窗格、动画、可配置化。

## AC
- `desktop/src/components/brand/QuickStartCards.test.tsx`：渲染 6 张卡；点击调用 `onPick` 且参数为对应 `quickStart.<id>.prompt`（用 i18n 测试 init 或 mock `useTranslation` 返回 key）。
- `npx tsc --noEmit` 对新文件无报错（ChatPane 原有 6 条报错不增加）。
