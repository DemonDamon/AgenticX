---
name: session-history-running-spinner-fix
overview: 修复会话已完整结束（含推荐问）但历史侧栏仍显示 running 转圈的严重状态不同步问题。
todos:
  - id: backend-normalize-running
    content: list_sessions 对 stale running + 终态 assistant（suggested_questions/closed followups）归一为 idle
    status: completed
  - id: frontend-clear-hint
    content: sendChat finally 与 SSE final 时 clearSessionHistoryHint
    status: completed
  - id: tests
    content: pytest 覆盖 in-memory running + 终态 reply 的 listing 归一
    status: completed
isProject: false
---

# 历史侧栏 running 转圈不消失修复

## 现象

- FR-1：主聊天区已结束（工具完成、完整回答、三个推荐问），历史对话项仍显示 running spinner。

## 根因

- `_normalize_execution_state_for_listing` 对 `raw == "running"` 直接返回，未像 `scan_interrupted_sessions` 那样结合磁盘/内存消息判断终态。
- `sendChat` 结束时只 `bumpSessionCatalogRevision`，未 `clearSessionHistoryHint`；若 API `updated_at` 滞后，hint 可能继续强制 running。

## 修复

- `session_manager.py`：`_messages_for_execution_state_check` + `_last_turn_has_terminal_assistant_reply`（suggested_questions 或 `</followups>`）。
- `ChatPane.tsx`：`finally` 与 meta `final` SSE 时 `clearSessionHistoryHint(requestSessionId)`。

## 验收

- AC-1：单 session 跑完含推荐问后，1–2 个 poll 周期内历史 spinner 消失。
- AC-2：工具循环中途（仅有 thinking、无 followups）仍显示 running。
- AC-3：并发切 session 场景不回归。
