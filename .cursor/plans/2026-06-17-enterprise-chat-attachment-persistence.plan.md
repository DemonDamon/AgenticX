# Enterprise 历史对话图片附件持久化修复

## What & Why

用户带图发送后，刷新/切换会话再回来，用户气泡只剩文字、图片消失。根因是 web-portal `POST .../messages` 的 `sanitizeInboundMessages` 未解析 `attachments`，落库时 metadata 为空。

## Requirements

- FR-1: append/replace 写入时保留合法图片 attachments 到 `chat_messages.metadata`
- FR-2: GET 历史消息继续从 metadata 还原 attachments（已有 `mapMessageRow`）
- FR-3: 允许「仅附件无正文」的用户消息通过校验
- AC-1: 带图发送 → 刷新/切会话 → 用户气泡仍展示缩略图
- AC-2: `chat-message-sanitize.test.ts` 通过

## Implementation

- `enterprise/apps/web-portal/src/lib/chat-message-sanitize.ts` — 提取并补全 attachments 校验
- `enterprise/apps/web-portal/src/app/api/chat/sessions/[sessionId]/messages/route.ts` — 改用 lib
- 已有历史（修复前发送）metadata 无附件，无法自动恢复，需重新发送
