---
name: kb-retrieval-toggle-and-session-ui-leak-fix
overview: 修复并发 session 切换时的 P0 不可用问题：lazy 新对话无法切换知识库检索模式；切回后台运行中的 session 误弹「已停滞」且流式输出中断。
todos:
  - id: kb-toggle-race
    content: PaneKnowledgeRetrievalModeSwitch refresh 加 generation guard，saveMode 后二次读 per-session
    status: completed
  - id: kb-lazy-pane
    content: lazy 新对话（sessionId 为空）用 pane pending key 持久化检索模式，首条发送 migrate 到真实 session
    status: completed
  - id: session-ui-reset
    content: 切换至空 session 或新 session 时立即 reset execution UI + listSessions cancelled
    status: completed
  - id: per-session-progress
    content: sessionProgressAtRef 记录后台 SSE 进度，重入 running session 恢复流式/抑制误报 stall
    status: completed
  - id: sse-guard
    content: 后台 SSE 的 UI 更新仍门控 isTargetSessionStillActive；进度时间戳始终按 session 写入
    status: completed
isProject: false
---

# 知识库检索切换 + 并发 Session 切换 P0 修复

## 现象

1. Session A 流式输出中新建 lazy 新对话：检索模式无法切到「智能检索」；新对话误显 sibling 的「后台运行中」。
2. 切回正在输出的 Session A：历史侧栏转圈消失、无流式续播，直接弹「已停滞 10s」。

## 根因

- **检索模式**：`createNewTopic` 将 `pane.sessionId` 置空，`saveMode` 对空 id no-op；stale `readConfig` 覆盖用户选择。
- **执行态泄漏**：窗格级 `sessionExecutionState` / stall 检测在切到 `sessionId=""` 时未 reset。
- **误报停滞**：切走时 `sessionStillActive=false` 不再刷新 `lastProgressAtRef`，但后台 SSE 仍在跑；重入时重置了静默时钟却未恢复 per-session 进度 → `channelA/B` 在仍 running 且仍有后台 token 时误判 stall。

## 修复

- `kb-retrieval-mode.ts`：`__pane_pending__:{paneId}` + `migratePaneKbRetrievalModeToSession`。
- `ChatPane`：`sessionProgressAtRef`；`recordProgressActivity(sessionKey)` 始终写 session 时间戳。
- Session 进入 effect：对 `__awaiting_fresh__:{paneId}` 与真实 sid 均 reset；重入时恢复 `sessionProgressAtRef` + `syncStreamingUi`；running 时 merge/reattach。
- SSE：`recordSseActivity(requestSessionId)` 不依赖当前是否显示该 session。

## 验收

- AC-1：lazy 新对话（无 sessionId）可切「智能检索」并保持，首条发送后写入真实 session。
- AC-2：A 后台 running 时新建 B，B 不显示 A 的 running/后台运行中。
- AC-3：切回 A 后恢复流式或 reattach/merge，10s 内不误弹「已停滞」（除非真 hung）。
