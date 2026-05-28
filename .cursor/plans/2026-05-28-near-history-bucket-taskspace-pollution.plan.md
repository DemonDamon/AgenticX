---
name: near-history-bucket-taskspace-pollution
overview: 拔掉历史侧栏 Today 桶污染源（taskspace 增删时批量刷 updated_at）并让 resolver 不再让 touch_at 压过 message_based，已被污染的元数据自然回归正确分组。
todos:
  - id: stop-bulk-touch
    content: add_taskspace / remove_taskspace 不再对同 scope 下其它会话写 updated_at
    status: pending
  - id: resolver-prefer-messages
    content: _resolve_list_activity_at 在 message_based>0 时直接返回 message_based，touch_at 只作 fallback
    status: pending
isProject: false
---

# Near 历史会话 Today 桶污染修复（taskspace 批量 touch）

## 根因

- `agenticx/studio/session_manager.py` 的 `add_taskspace` / `remove_taskspace` 在批量循环里 `each.updated_at = time.time()`，把该 scope 下所有 ManagedSession 的 updated_at 刷成同一秒（线上数据：2026-05-28 13:05:47 一秒内 30+ 会话被改写）。
- `_resolve_list_activity_at` 的 `if touch_at > message_based: return touch_at` 分支让被污染的 updated_at 压过真实消息时间戳，重启后老会话被全部冲进 Today。

## 方案

1. `add_taskspace` / `remove_taskspace` 改 taskspaces 后仍调用 `_persist_session_state` 落盘，但不再对各 session 写 `updated_at`。工作区列表的变更不应被视为 session 活动。
2. `_resolve_list_activity_at` 在 `message_based > 0` 时直接返回 `message_based`；`touch_at` 只在没有任何消息活动时兜底（保留 chat() 路径下「无消息但已 touch」的优先级）。
3. 历史已污染的 metadata 不需要主动 backfill：下次正常持久化时，`last_activity_at` 已是消息时间戳，列表桶位会立即恢复正确。

## 验收

- 用户单纯打开 / 浏览历史会话不会改变其分组。
- 增删工作区文件夹后，所有非当前会话的桶位保持不变。
- 重启后 TODAY 仅含当日真实有过消息的 session。
