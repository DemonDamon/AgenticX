---
name: kb-reference-open-document
overview: 点击 KB 引用角标/文件名时用系统默认应用打开源文件，显示加载进度遮罩，不再跳转设置页知识库。
todos:
  - id: api-get-doc
    content: GET /api/kb/documents/{doc_id} 返回 source_path
    status: completed
  - id: overlay-open
    content: 全屏加载遮罩 + shellOpenPath 打开本地文件
    status: completed
  - id: wire-click
    content: openKbReference 改走 openKbDocumentFromReference
    status: completed
isProject: false
---

# KB 引用点击打开文档（对齐 ima）

## 背景

点击 CitationPopover / ReferencesCard 中 KB 文件会 `openSettings('knowledge')`，用户被带到设置页（不合理）。

期望：显示「加载文件 N%」遮罩 → 用系统默认应用打开 PDF/MD 等源文件。

## 方案

- `GET /api/kb/documents/{doc_id}`：解析 `source_path`
- `openKbDocumentFromReference`：拉取文档 → `shell.openPath`
- `KbDocumentOpenOverlay`：挂到 `App.tsx` 全局 portal

## 修复：点击后 Not Found（2026-06-03）

- **根因**：`build_kb_references` / 前端 fallback 将 `source.uri`（本地绝对路径）当作 `doc_id`，`GET /api/kb/documents/{path}` 返回 404。
- **修复**：优先 `metadata.document_id` → `hit.id` 去掉 `::chunk` → 非路径的 `uri`；附带 `kb_source_path`；打开时路径型 URL / 404 回退 `shellOpenPath`。

Plan-Id: 2026-06-03-kb-reference-open-document
Plan-File: .cursor/plans/2026-06-03-kb-reference-open-document.plan.md
