---
name: Desktop paste image
overview: Pro ChatPane 输入框粘贴剪贴板图片，复用 parseLocalFile；支持仅附件发送（占位 user_input）。
todos:
  - id: util-clipboard
    content: clipboard → File[] 提取（含去重、默认文件名）
    status: completed
  - id: chatpane-paste
    content: ChatPane textarea onPaste + 图文混合
    status: completed
  - id: send-empty-with-attachments
    content: sendChat / hasInput / 占位文案
    status: completed
  - id: verify-manual
    content: 本地验证粘贴与纯附件发送
    status: completed
isProject: true
---

# Desktop 输入框粘贴图片

## 实现摘要

- 新增 [`desktop/src/utils/clipboard-images.ts`](desktop/src/utils/clipboard-images.ts)：`extractClipboardImageFiles`、`withClipboardImageNames`。
- [`desktop/src/components/ChatPane.tsx`](desktop/src/components/ChatPane.tsx)：`textarea` `onPaste`；`sendChat` 在 `readyAttachments.length > 0` 时允许空文本；`ATTACHMENT_ONLY_USER_PROMPT` 作为 API 与气泡文案；`hasInput` 含就绪附件。

## Requirements

- FR-1：在 ChatPane 输入框粘贴截图/图片时，附件区出现与文件选择一致的 chip。
- FR-2：图文同时粘贴时，图片进附件，文本追加到输入框。
- FR-3：仅有就绪附件、无文字时可发送（满足 `user_input` min_length）。
- AC-1：`npx tsc -p desktop/tsconfig.json --noEmit` 中本次改动文件无新增错误（仓库内另有既有 TS 报错）。

## 非目标

- Lite ChatView 附件管线、豆包式「解释图片」按钮、多模态像素进 LLM（仍为 context 占位）。
