# 长任务可恢复暂停与产物门禁修复

- Plan-Id: 2026-05-18-long-task-recovery-gates
- Owner: Damon Li
- Status: Implemented

## Problem

上一波修复后，用户已经能看到 `compaction` 与 token budget warning，但长任务仍会在 LLM `RateLimitError` 后停止，且 UI 可能仍出现“后台任务已完成”之类误导状态。文档类任务还可能已经写入文件，但最终汇报失败，或写出的文档引用不存在路径，导致“看似完成但产物不可信”。

## Scope

只修 runtime 可靠性闭环：

- RateLimit / token-budget 的可恢复暂停状态。
- spawn / delegation 两条子任务路径都不能把暂停误标为 completed。
- 文档类产物必须有最小路径门禁：明确要求输出文件时，完成前校验产物文件真实存在；若缺失则失败/校验失败。
- 不重写 compactor 算法，不扩大到完整文档语义评审。

## Requirements

- FR-1: `SubAgentStatus` 增加 `PAUSED`，`TeamManager` 收到 `SUBAGENT_PAUSED` 后标记 paused，而非 completed。
- FR-2: `AgentRuntime` 在 LLM 调用异常为 rate limit 时，对非 meta agent 发 `SUBAGENT_PAUSED`，携带 `detector=rate_limit`、`retryable=true`、`round/max_rounds`；对 meta 仍发 warning/error 但不伪装完成。
- FR-3: `meta_tools._run_delegation_in_avatar_session` 将 `SUBAGENT_PAUSED` 的 `detector`、`retryable`、`round/max_rounds` 写入 `_delegation_info`，summary 明确“限流暂停/可稍后继续”。
- FR-4: spawn 与 delegation 的终态事件选择：paused 发 `SUBAGENT_PAUSED`，不走 completed/error。
- FR-5: 文档/文件产物门禁：任务要求输出文件时，若检测到产物路径但文件不存在，终态为 failed，并提示缺失路径；若没检测到产物，沿用已有失败。
- FR-6: Desktop 继续复用 `paused` 状态展示；`detector=rate_limit` 时文案显示“限流暂停，可稍后继续”。

## Acceptance Criteria

- AC-1: RateLimitError 不再只显示普通“模型调用失败”后让任务看似完成，而是让分身/子任务进入 `paused` 状态。
- AC-2: max_tool_rounds 与 rate limit 两类暂停都能透传到 Desktop 的 paused UI。
- AC-3: 明确要求写文件的任务，如果产物路径不存在，不会被标记 completed。
- AC-4: 已写入且真实存在的产物，即使最终汇报失败，也能在状态摘要里露出文件路径，方便用户继续。

