---
name: Group Inline Confirm Actions
description: 在群聊 blocked 状态消息中提供一键同意/拒绝，避免用户切 pane 查找确认入口
---

# 群聊内联确认按钮方案

## 背景

当前群聊里分身进入 `confirm_required` 后，用户只能看到阻塞提示文本，无法在消息处直接确认，导致流程中断且操作路径不直观。

## 目标

1. 在群聊 `group_blocked` 消息上展示“同意/拒绝”按钮。
2. 点击按钮后调用 `/api/confirm`，并回写结果到当前群聊消息流。
3. 确认后移除该阻塞消息的可操作状态，避免重复提交。

## 实施范围

- `agenticx/runtime/group_router.py`
  - `group_blocked` 事件附带 `confirm_request_id`。
- `agenticx/studio/server.py`
  - 透传 `confirm_request_id` 到 SSE `group_blocked` data。
- `desktop/src/store.ts`
  - 为消息结构添加内联确认元数据。
- `desktop/src/components/ChatPane.tsx`
  - 接收 `group_blocked` 时写入可确认消息。
  - 增加点击确认后的请求与结果回写逻辑。
- `desktop/src/components/messages/MessageRenderer.tsx`
  - 为 tool 卡片渲染内联确认操作按钮。

## 验证

1. 群聊中触发 `confirm_required`，消息卡片出现“同意/拒绝”按钮。
2. 点击任一按钮后：
   - 请求 `/api/confirm` 成功；
   - 群聊新增“确认通过/确认拒绝”反馈；
   - 原阻塞消息不再可重复确认。
3. Python 编译与前端类型检查通过（或确认无本次改动新增错误）。
