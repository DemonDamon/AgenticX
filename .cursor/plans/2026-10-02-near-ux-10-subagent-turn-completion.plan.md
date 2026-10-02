# Near-UX-10：子智能体未全部完成时不呈现「已完成」，并由主智能体统一汇总

Planned-with: Claude Sonnet 5.5
Suggested-Impl-Model: Codex 中档（跨 App.tsx 轮询链路，需谨慎）
Plan-Id: 2026-10-02-near-ux-10-subagent-turn-completion
Plan-File: `.cursor/plans/2026-10-02-near-ux-10-subagent-turn-completion.plan.md`

## 根因（会话 f0e48d91 的 messages.json 取证）
1. 主智能体消息 13 带 `turn_terminal: true / terminal_reason: status_query_cooldown`，内容为"先停止轮询，完成后主动汇报"。UI 把它当完整回答，显示来源与复制/引用/收藏/转发按钮，但仍有子智能体在跑。
2. 后端 `agenticx/studio/server.py::_on_subagent_summary` 把子智能体原始产出以 `role=assistant`、前缀 `子智能体汇总:` 写入 chat_history，用户可见，机械。
3. 桌面端 `App.tsx::triggerMetaReport` 每 2 秒轮询、每个子智能体完成就触发一次，触发语只要求"汇报完成情况"，且每条摘要只带 300 字，主智能体既不等齐、也没被要求完成用户原请求里的"汇总对比"。

## 改动
- A（`desktop/src/App.tsx` + 新增 `desktop/src/utils/auto-report-gate.ts`）：同会话仍有活跃子智能体（pending/running/awaiting_*）时，自动汇报排队不触发；排队超过 10 分钟放行。队列项增加 `queuedAt`。触发语改为"全部结束；请结合用户最初请求直接完成汇总/对比/成稿，不要复述状态、不要原样粘贴"；每条摘要带入长度 300→2000。
- B（`desktop/src/components/ChatPane.tsx` + 新增 `desktop/src/utils/subagent-summary-message.ts`）：`visibleMessages` 过滤 `assistant` 且以 `子智能体汇总:` 开头的行。后端内容与前缀不变（`meta_tools.py`/`meta_agent.py` 依赖）。
- C（`ChatPane.tsx`）：本会话有活跃子智能体时，最后一条 assistant 消息及 ReAct 尾部不渲染操作按钮与时间戳（`subAgentsPending`，复用 `summarizeAgentActivity`）；全部结束后自动恢复。

## Out of scope
后端 summary_sink 逻辑、子智能体调度、群聊窗格、"来源"行（属模型正文，不改）。

## AC
- `auto-report-gate.test.ts`、`subagent-summary-message.test.ts` 通过；`tsc` 对 `App.tsx`/`ChatPane.tsx` 不新增错误（各 6 条原有）。
- 手测：并行派 3 个子智能体——未全部结束时无操作按钮；结束后出现一条主智能体的汇总对比，不再出现 `子智能体汇总:` 原文行。
