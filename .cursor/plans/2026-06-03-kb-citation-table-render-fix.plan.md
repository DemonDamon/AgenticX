---
name: kb-citation-table-render-fix
overview: 修复知识库/聊天中带角标的 GFM 表格 Markdown 被 citation 分段拆碎导致表格渲染错乱。
todos:
  - id: table-split
    content: splitCitationSegmentsRespectingTables 保持表格为整段
    status: completed
  - id: table-cell-cite
    content: td/th 内解析 [N] 渲染 CitationBadge
    status: completed
  - id: tests
    content: citation-normalize.test 覆盖表格分段
    status: completed
isProject: false
---

# KB 表格内角标渲染修复

## 根因

`splitCitationSegments` 在 `[N]` 处切断 Markdown，表格各行被拆成多个 `ReactMarkdown` 片段，GFM 无法识别表格结构。

## 方案

- `splitCitationSegmentsRespectingTables`：连续 GFM 表格行保留为单个 text segment
- `makeCitationTableMarkdownComponents`：在 td/th 内对单元格文本做 citation 拆分并渲染 pill

## Requirements

- FR-1: 表格单元格内 `[N]` 显示为角标 pill，表格结构正常
- AC-1: 表头、分隔行、多行数据均可渲染

Plan-Id: 2026-06-03-kb-citation-table-render-fix
Plan-File: .cursor/plans/2026-06-03-kb-citation-table-render-fix.plan.md
