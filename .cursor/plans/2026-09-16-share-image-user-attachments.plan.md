# 分享图片带上用户附件芯片

Planned-with: Cursor Grok 4.6
Suggested-Impl-Model: Composer 2.5

> **For implementer:** 只改本文件列出的符号。禁止改 PDF 导出、禁止改聊天气泡 `ImBubble` 附件交互、禁止改 `server.py`。不要 commit，除非用户明确要求。

**Goal:** 分享为图片时，用户消息上方要出现与对话里同款的附件芯片（缩略图 + 文件名 + 扩展名），不再只剩纯文本气泡。

**Architecture:** 分享图 v1 的 `buildShareImageTurns` 对 user 只取 `messagePlainTextForClipboard`，丢掉 `attachments`。把可见上传附件挂到 user turn，预览卡按对话布局（芯片在气泡上方、右对齐）复用 `AttachmentCard`。

**Tech Stack:** Desktop React + 现有 Vitest。

---

## 根因（证据链）

对话里用户图是 `ImBubble` 的 `displayAttachments` + `AttachmentCard`（气泡外、右对齐）。分享图走 `buildShareImageTurns`（`desktop/src/utils/share-image-model.ts` L90–92）只推 `{ kind: "user", text }`；`ShareImagePreviewModal.tsx` L226–236 只渲染 `turn.text`。`.cursor/plans/2026-08-13-chat-share-menu.plan.md` v1 写明「只渲染正文」，所以附件从未进入卡片。

## In scope

- user turn 携带可见附件
- 分享预览 / 栅格 PNG 画出芯片
- 模型层单测

## Out of scope

- PDF / 复制文本
- 助手消息附件
- 工作区 `@file` 引用芯片（对话里也不走 `AttachmentCard` 这一排）
- 芯片点击放大（分享卡可复用 `AttachmentCard`，不必新做 lightbox）

---

## FR-1：user turn 带附件

**落点：** `desktop/src/utils/share-image-model.ts`

1. `ShareImageTurn` user 变体改为 `{ kind: "user"; text: string; attachments?: MessageAttachment[] }`。
2. 新增 `shareVisibleUserAttachments(message)`：`(message.attachments ?? []).filter((a) => !isWorkspaceReferenceAttachment(a))`。过滤器与 `ImBubble.tsx` L316 的 `displayAttachments` 同一语义。
3. `buildShareImageTurns` user 分支：text 仍用 `messagePlainTextForClipboard`；可见附件非空时写入 `attachments`，空则省略该字段（保持旧单测 `toEqual({ kind: "user", text })`）。

**落点：** `desktop/src/utils/share-image-graphics.ts` 的 `HydratedShareTurn` user 变体同步加 `attachments?`。`hydrateShareImageTurns` 已 `out.push(turn)`，无需改逻辑。

**AC-1：** `desktop/src/utils/share-image-model.test.ts` 新增：

- 用户消息带 `name/mimeType/dataUrl` 的图片附件 → turn 含该 attachments
- 仅 `referenceToken: true` + `sourcePath` 的工作区引用 → **不**出现在 attachments
- 无附件用户消息仍为 `{ kind: "user", text }`（无 attachments 键）

现有 `share-image-graphics.test.ts` L99 `toEqual({ kind: "user", text: "画图" })` 必须仍绿。

## FR-2：预览卡右对齐芯片

**落点：** `desktop/src/components/ShareImagePreviewModal.tsx` 约 L226–236。

**Before：** 仅一个右对齐文本气泡。

**After：** 外层仍 `flex justify-end`；内层 `flex flex-col items-end gap-1.5 max-w-[78%]`：

- `attachments?.length` 时：`flex flex-wrap justify-end gap-2`，对每个附件渲染 `AttachmentCard`（`desktop/src/components/messages/AttachmentCard.tsx`）
- `text.trim()` 时再画原来的圆角气泡

无正文仅附件时只画芯片，不画空气泡。`waitForImages` 已存在，缩略图 `dataUrl` 栅格前会等加载。

**AC-2：** 手测：多选含图片附件的用户轮 → 分享为图片 → 预览卡用户气泡上方有文件名 + JPG 芯片（有 `dataUrl` 时带缩略图）；复制/下载 PNG 里同样可见。无附件对话外观不变。

## 验证

```bash
cd desktop && npx vitest run src/utils/share-image-model.test.ts src/utils/share-image-graphics.test.ts
```
