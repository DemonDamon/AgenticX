# Desktop 会话重载 txt 附件消失修复

Planned-with: claude-sonnet-5-thinking-medium
Suggested-Impl-Model: gpt-5.3-codex

**Goal:** 修复拖拽/粘贴 txt 附件在切换 session 后从用户气泡消失的问题。

**Architecture:** Desktop 上传去重 key（`name:size:lastModified`）被误当作 `sourcePath` 与 `context_files` key，后端将其解析为行号引用并持久化 `reference_token=true`；重载后 UI 按 workspace 引用过滤掉 AttachmentCard。修复发送侧 key、后端持久化分类，并对已污染历史做重载兜底。

---

## FR

- FR-1: 本地上传 txt/文档附件持久化后切换 session 仍显示 AttachmentCard
- FR-2: 新发送的上传附件 `context_files` key 不得使用 `name:size:lastModified`
- FR-3: 后端不得将 upload dedupe suffix 当作 `line_start/line_end`
- FR-4: 已写入 messages.json 的污染记录重载后仍可见

## AC

- AC-1: `attachmentsFromSessionRow` 对污染 row 不再归类为 workspace reference
- AC-2: Python 单测覆盖 upload dedupe key 解析
- AC-3: 现有 workspace `@file` 行号引用行为不回退
