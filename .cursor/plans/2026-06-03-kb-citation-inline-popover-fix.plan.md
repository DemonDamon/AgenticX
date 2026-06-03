---
name: kb-citation-inline-popover-fix
overview: 修复知识库角标单独换行与悬停预览被裁切两个问题。
todos:
  - id: inline-layout
    content: 段落块内行内排版 + p/ol/ul 组件避免角标换行
    status: completed
  - id: popover-portal
    content: CitationPopover portal 到 body 并视口内定位
    status: completed
  - id: split-blocks
    content: splitCitationParagraphBlocks 按空行分段
    status: completed
isProject: false
---

# KB 角标行内排版与悬停预览裁切修复

## 现象

- FR-1：角标 `[N]` 出现在列表项/句子下一行，未紧跟正文（如「1. UToken 网关产品 (PDF)」后）。
- FR-2：鼠标悬停角标时，预览卡片左侧或上方被气泡/ReferencesCard 裁切。

## 根因

- `CitationMarkdownBody` 按 `[N]` 切段后每段独立 `ReactMarkdown`，生成块级 `<p>`/`<ol>`，角标作为兄弟节点跟在后面。
- `CitationBadge` 使用 `absolute bottom-full` 相对气泡定位，受父级 `overflow` 与靠左居中偏移影响。

## 修复

- `splitCitationParagraphBlocks`：仅按空行分段，同段内角标与正文同一行内流。
- `inlineCitationMarkdownComponents`：`p` 使用 `display: contents`，`ol`/`ul` 使用 `inline list-inside`。
- `CitationBadge`：`createPortal` + `fixed` 定位，左右 clamp，上方不足时改下方展示。

## Requirements

- FR-1: 角标与紧邻正文同一行展示（列表项后不换行）
- FR-2: 悬停预览完整可见，不被聊天区域裁切

## AC

- AC-1: 「1. xxx (PDF)[1]」角标在同一行末尾
- AC-2: 靠左/靠上角标悬停时预览卡片完整显示

Plan-Id: 2026-06-03-kb-citation-inline-popover-fix
Plan-File: .cursor/plans/2026-06-03-kb-citation-inline-popover-fix.plan.md
