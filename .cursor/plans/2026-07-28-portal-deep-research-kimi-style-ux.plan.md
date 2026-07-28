# Portal 深度研究：可展开步骤时间线 + 确认面板 UX

Planned-with: grok-4.5  
Suggested-Impl-Model: composer-2.5（纯前端步骤聚合 + Clarify 面板；编排侧仅短叙事 delta）

## 问题

当前「研究过程」把澄清题、超时、车道、产物全部打成灰色 bullet，像日志糊在一起；澄清确认面板不够突出，超时后只剩灰字；步骤不可展开看细节。对标交互期望：一边做一边回复、独立询问确认面板、每步可点开右侧展开细节。

## In scope

1. 事件聚合为可展开步骤行（图标 + 竖虚线 + chevron）
2. 「询问工具」独立确认面板（等待确认 / 已收集信息）
3. 澄清答案写入 `deep_research.clarifyAnswers` 并随消息持久化
4. 编排侧用 `narrative` 事件承载短叙事（**禁止**写入 content）；content 仅终稿
5. 备忘产物挂到车道步骤展开区；主气泡只突出终稿卡片
6. **交错时间线**：`DeepResearchWorkbench` 按事件顺序渲染 narrative → clarify → tools 卡 → narrative → status → artifact，禁止「澄清块 + 整段研究过程 + 正文」三大坨堆叠

## Out of scope

- 真实 Python / Terminal / 「电脑」沙箱执行（portal 无执行面；图6仅作视觉参考）
- Desktop / agenticx / Go gateway / admin-console
- 恢复空态「深度研究」pill 入口

## 落点

- `enterprise/features/chat/.../deep-research-steps.ts`（新建）
- `DeepResearchTimeline.tsx` / `DeepResearchClarifyCard.tsx` / `MessageList.tsx`
- `enterprise/packages/core-api/src/chat.ts` + sanitize
- `enterprise/features/chat/src/store.ts`（`setDeepResearchClarifyAnswers`）
- `enterprise/apps/web-portal/src/lib/deep-research/orchestrator.ts`（叙事 delta）

## AC

- 澄清题不再以 timeline 灰字列表刷屏；awaiting 时面板可点选并继续
- 车道行可展开看到来源数 / 备忘路径；报告 artifact 可点「查看产物」
- 刷新后 clarifyAnswers 仍可回显（若已落库）
- 新跑一轮：叙事句出现在澄清面板前后，工具卡单独成块，终稿 markdown 不再前置进度句
- `buildDeepResearchSegments` 单测：kind 序列含交错 narrative/clarify/tools
