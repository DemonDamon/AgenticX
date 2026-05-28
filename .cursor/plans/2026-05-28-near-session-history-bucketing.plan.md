---
name: near-session-history-bucketing
overview: 修复 Near 历史侧栏 Today/Previous 7 days 分组错误、发送后即时归入 Today、以及重启后出现空 session（·xxxxxxxx）的问题。
todos:
  - id: activity-timestamp
    content: 后端 list_sessions 按真实最后活动时间分组（消息时间 / touch / summary 恢复）
    status: completed
  - id: optimistic-today
    content: 发送瞬间 markSessionHistoryActive + bump 历史列表
    status: completed
  - id: hide-empty-sessions
    content: 过滤无消息的内存 session；冷启动不再预建空 session
    status: completed
  - id: tests
    content: session_manager_persistence 回归测试
    status: completed
isProject: false
---

# Near 会话历史分组与空 session 修复

## 问题

1. 旧 session 继续聊天后未移入 Today，或全部被 bulk 刷坏的 `updated_at` 挤进 Today。
2. 发送消息后应立刻在 Today 转圈，而非等流式结束。
3. 重启后出现 `·9fba0be6` 类无标题空 session。

## 方案

- **后端**：`_resolve_list_activity_at` 综合消息 timestamp、summary 历史恢复、内存 `touch()`；`list_sessions` 隐藏无 user/assistant 消息的内存 session。
- **前端**：`sessionHistoryHints` 乐观更新；`App.tsx` 冷启动对齐 lazy-create，不预建空 session。
- **测试**：`test_session_manager_persistence.py` 覆盖 touch 优先与 summary 恢复。

## 验收

- 仅今天聊过的 session 在 Today；其余在 Previous 7 days / Older。
- 发送瞬间 session 移入 Today 并显示 running。
- 重启后历史侧栏不出现空 `·xxxxxxxx` session。
