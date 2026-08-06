# Deep Research Clarify Timeout UX Fix

Planned-with: claude-opus-4.6
Suggested-Impl-Model: composer-2.5

## Goal

修复门户深度研究澄清卡片在超时（或 waiter 已释放）后仍可点「确认并继续」、并裸露
`{"error":{"code":"40401","message":"no pending clarify for runId"}}` 的体验问题；超时后续跑
应被识别为「已继续」而非致命失败。

## Root cause（证据）

- 澄清挂起在进程内 `waiters` Map（`enterprise/apps/web-portal/src/lib/deep-research/run-wait.ts`）
- 默认 `CLARIFY_TIMEOUT_MS = 120_000`（`orchestrator.ts`）；超时后 `resolve({ skip: true, timedOut: true })` 并删除 waiter，编排继续检索
- 用户再 POST `/api/chat/deep-research/resume` → `resolveClarifyResume` 返回 false → 40401
- `DeepResearchClarifyCard.submit` 把 `response.text()` 原样塞进红色 error；且仅在 `response.ok` 时调用 `onSubmitted`，故 UI 可能长时间停在「等待确认」

## In scope

1. resume API：无 pending waiter 时改为幂等成功（`resumed: false, alreadyContinued: true`），不再 404
2. 澄清默认超时 120s → 300s；completions `maxDuration` → 900s
3. ClarifyCard：解析响应；已继续时友好中文提示并退出 awaiting；卡片提示「5 分钟内确认」
4. **澄清 waiter 文件持久化**（`.runtime/deep-research-clarify/` + `globalThis` Map）：修复 Next HMR / 多 isolate 导致「不到超时却 alreadyContinued / 假超时」
5. 纯函数 + run-wait / parse 回归测试

## Out of scope

- 多副本共享 waiter（Redis 等）
- 超时后把用户迟到答案补注入已启动的检索链路
- Desktop / admin-console

## Suggested-Impl 子任务

| 子任务 | 推荐模型 | 理由 |
|---|---|---|
| resume 幂等 + 超时常量 | composer-2.5 / kimi-code | 小改后端样板 |
| ClarifyCard UX + 解析 helper | composer-2.5 | 前端局部 |
| 回归测试 | composer-2.5 | 单元测试 |

## FR / AC

- FR-1: 无 pending clarify 时 resume 返回 200 + `alreadyContinued: true`（非 40401）
- FR-2: 卡片对「已继续」展示中文说明并退出交互态，不展示原始 JSON
- FR-3: 默认澄清超时 ≥ 300s
- AC-1: `formatClarifyResumeResponse` / resume route 单测覆盖 ok / alreadyContinued / 其它错误
- AC-2: 超时后点确认不再出现红字 JSON；卡片变为只读或折叠

## 落点

- `enterprise/apps/web-portal/src/app/api/chat/deep-research/resume/route.ts`
- `enterprise/apps/web-portal/src/lib/deep-research/orchestrator.ts`（`CLARIFY_TIMEOUT_MS`）
- `enterprise/features/chat/src/components/molecules/DeepResearchClarifyCard.tsx`
- 新建 `enterprise/features/chat/src/utils/deep-research-clarify-resume.ts` (+ `.test.ts`)
- 可选：`enterprise/apps/web-portal/src/lib/deep-research/run-wait` 旁小测或 route 级测

## no-scope-creep

只改澄清 resume / 超时常量 / ClarifyCard 错误展示相关路径；不重构 orchestrator 主流程。
