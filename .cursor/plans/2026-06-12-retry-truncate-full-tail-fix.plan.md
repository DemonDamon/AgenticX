# 重试截断删除目标 user 之后全部消息（修复后续轮次残留）

Plan-Id: 2026-06-12-retry-truncate-full-tail-fix
Plan-File: .cursor/plans/2026-06-12-retry-truncate-full-tail-fix.plan.md

## 背景 / 问题

用户在三轮对话中重试第二轮 user 消息后，第三轮对话仍残留在 UI 与 `messages.json`。

根因：
1. `truncate` 的 `after` 模式只删到「下一条 user」，未删其后全部轮次。
2. `view_image` 注入行 `role=user` 被当成下一轮边界，导致 `removed=0`。
3. 前端 `hasTrailingTurnMessages` 同样在下一条 user 处截断，误判 truncate 成功。

## 目标行为

- retry(`after`)：定位目标 user（含 `user_occurrence`）后，删除 `idx+1` 至末尾的全部消息。
- 后续轮次、system-injected user、assistant/tool 一并清除。

## 改动

- `agenticx/studio/server.py`：`after` 改为 `del rows[idx+1:]`
- `desktop/src/components/ChatPane.tsx`：`hasTrailingTurnMessages` 改为 `userIdx < msgs.length - 1`
- `tests/test_studio_server.py`：更新重复文案用例；新增 view_image inject + 多轮场景

## 验收

- AC-1：重试第二轮后，同文案的第三轮 user 不再保留
- AC-2：system-injected user 不再阻断截断
- AC-3：truncate 相关 pytest 全绿
