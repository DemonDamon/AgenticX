---
name: kb-retrieval-toggle-and-session-ui-leak-fix
overview: 修复 ChatPane 两处窗格级 UI 泄漏：知识库检索模式切换被 stale readConfig 覆盖；新建/切换 session 时 sibling 后台运行的 execution 状态与 SSE 进度污染当前 session（误显「后台运行中」）。
todos:
  - id: kb-toggle-race
    content: PaneKnowledgeRetrievalModeSwitch refresh 加 generation guard，saveMode 后二次读 per-session
    status: completed
  - id: session-ui-reset
    content: session 切换时立即 reset executionState/toolProgress/contextStats + listSessions cancelled
    status: completed
  - id: sse-guard
    content: 后台 SSE 的 recordSseActivity/tool_progress/context_stats 仅在 isTargetSessionStillActive 时更新 UI
    status: completed
isProject: false
---

# 知识库检索切换 + Session 执行态 UI 泄漏修复

## 现象

1. 聊天输入区检索模式下拉选「智能检索」无效，勾仍停在「始终检索」（全局默认 always）。
2. Session A 后台运行中，新建/切到 Session B 时，输入区上方误显「运行中 · knowledge_search · 后台运行中」。

## 根因

- **检索模式**：`refresh()` 异步 `readConfig()` 返回后未再读 per-session localStorage，stale 全局 always 覆盖用户刚选的 auto。
- **执行态泄漏**：`sessionExecutionState` / `lastToolProgress` / `contextLoopStats` 为窗格级 state；切换 session 未立即清空；旧 session SSE 与 stale `listSessions` 回调继续写入当前 UI。

## 修复

- `PaneKnowledgeRetrievalModeSwitch`：`refreshGenRef` 丢弃 stale refresh；`readConfig` 后二次 `getSessionKbRetrievalMode`。
- Session 进入 effect：切换时 reset execution UI；`listSessions` 加 `cancelled`。
- `sendChat` SSE 循环：`sessionStillActive` 门控 progress/stats/stall 相关 UI 更新。

## 验收

- AC-1：全局 always 下点「智能检索」，勾与图标保持 auto。
- AC-2：A 后台 running 时新建 B，B 输入区不显示「后台运行中」除非 B 自身 running。
