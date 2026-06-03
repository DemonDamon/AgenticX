---
name: kb-citation-layout-br-fix
overview: KB 角标挪至标题/句末行内展示；表格单元格内裸露 `<br>` 渲染为换行。
todos:
  - id: cite-relocate
    content: relocateCitationMarkersForDisplay + CitationMarkdownBody 接入
    status: completed
  - id: table-br
    content: td/th 将 <br> 转为 React 换行
    status: completed
  - id: inline-group
    content: buildCitationRenderGroups + 转义 1. 列表 + li 行内化
    status: completed
  - id: inline-heading
    content: h1-h6 行内化 + 正文组 blockLayout，修复 ### 标题 [N] 角标挤到段首
    status: completed
  - id: tests
    content: citation-normalize.test 覆盖挪位与分组
    status: completed
isProject: false
---

# KB 角标行末与表格 br 渲染微调

## 背景

用户反馈：角标 [1] 出现在段首而非「1. UToken 网关产品 (PDF)」行末；表格能力说明列裸露 `<br>` 标签。

## 方案

- `relocateCitationMarkersForDisplay`：行首 [N] 并到上一非空行末；仅 [N] 行并入上一行；单行 [N]text → text[N]
- `buildCitationRenderGroups`：段前 [N] 与标题同组行内渲染，避免角标夹在块级 Markdown 之间单独成行
- `escapeMarkdownOrderedListMarkers` + `li` 行内化：避免 `1. 标题` 变成块级 `<ol>` 把角标挤到下一行
- `h1`–`h6` 行内化 + `blockLayout` 正文组：`### 标题 [1]\n正文` 时角标贴在标题行末而非正文前
- `markdown-components` td/th：`renderCellContentWithBreaks`

## Requirements

- FR-1: 有 references 时角标显示在标题/句子行末
- FR-2: 表格内 `<br>` 显示为多行而非字面量
- AC-1: 与 ima 式绿色 pill 行内排版兼容（93bdc945）

Plan-Id: 2026-06-03-kb-citation-layout-br-fix
Plan-File: .cursor/plans/2026-06-03-kb-citation-layout-br-fix.plan.md
