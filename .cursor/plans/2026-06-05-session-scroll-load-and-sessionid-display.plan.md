---
name: session-scroll-load-and-sessionid-display
overview: 修复历史会话「向上滚动加载更早消息」在视口未溢出时无法触发的问题；补齐 App 恢复后会话无消息的尾部加载；将初始 tail 轮次对齐 plan（3 轮）；顶栏 Near 旁展示完整 sessionId 便于排查。
date: 2026-06-05
status: completed
owner: Damon Li
tags: [desktop, chatpane, session-history, paging, debug-ux]
todos:
  - id: fix-scroll-up-proactive
    content: ChatPane 视口未溢出时主动触发 loadOlder；提示文案可点击加载
    status: completed
  - id: fix-tail-rounds-index
    content: INITIAL_SESSION_TAIL_ROUNDS=3；session-tail-cache map 使用 startIndex+index 与 ownerSessionId
    status: completed
  - id: bootstrap-empty-session
    content: ChatPane 在 sessionId 已绑定但 messages 为空时自动 tail-first 加载
    status: completed
  - id: expose-sessionid-header
    content: 顶栏 Near 名称右侧展示完整 sessionId（mono 小字）
    status: completed
isProject: false
---

# 历史分页加载修复 + 顶栏 sessionId 暴露

**Plan-Id**: 2026-06-05-session-scroll-load-and-sessionid-display
**Plan-File**: `.cursor/plans/2026-06-05-session-scroll-load-and-sessionid-display.plan.md

## 现象
- 会话曾完整回复，现仅见尾部占位或截断内容
- 「向上滚动加载更早消息」可见但无法加载（视口未溢出时 scroll 事件不触发）
- 排查需要完整 sessionId 可见

## 根因
1. `scrollTop <= 64` 仅在 scroll 事件触发；内容不足一屏时用户无法上滚，事件永不触发
2. `INITIAL_SESSION_TAIL_ROUNDS = 1` 过激进，更早完整回复落在 `has_older` 区
3. App 恢复后仅有 sessionId、messages 为空时未走 tail-first（仅 SessionHistoryPanel.switchSession 会加载）

## 改动
- `session-tail-cache.ts`：tailRounds=3；map 用 `startIndex + index`
- `ChatPane.tsx`：proactive viewport fill + 可点击提示；空会话 bootstrap；顶栏 sessionId

## AC
- AC-1：有 has_older 且内容不足一屏时，自动连续加载直到可滚动或已无更早消息
- AC-2：点击「向上滚动加载更早消息」可手动触发
- AC-3：App 恢复后空 messages 的已绑定会话能显示尾部历史
- AC-4：顶栏 Near 右侧显示完整 UUID sessionId
