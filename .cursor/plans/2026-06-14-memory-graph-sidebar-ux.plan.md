---
name: Memory graph sidebar UX polish
overview: 侧栏记忆图谱顶栏收起按钮右置，并支持左边缘横向拖拽调宽。
todos:
  - id: t1-header-layout
    content: 侧栏顶栏范围标签与收起按钮同排右置
    status: completed
  - id: t2-resize-handle
    content: ChatPane 记忆图谱面板补左侧 col-resize 手柄
    status: completed
isProject: false
---

# Memory Graph：侧栏顶栏与横向伸缩

**Plan-Id**: 2026-06-14-memory-graph-sidebar-ux
**Plan-File**: `.cursor/plans/2026-06-14-memory-graph-sidebar-ux.plan.md
**Made-with**: Damon Li

## 需求

- FR-1: 侧栏模式收起按钮置于顶栏右侧，紧邻范围标签（元智能体/分身/群聊）。
- FR-2: 搜索与刷新独立第二行，不与收起按钮混排。
- FR-3: 记忆图谱侧栏左边缘可拖拽调宽（与历史面板共用 `historyWidth`）。
- AC-1: 宽屏内嵌与窄屏 overlay 两种布局均显示 resize handle。

## 改动文件

- `desktop/src/components/memory/MemoryGraphExplorer.tsx`
- `desktop/src/components/ChatPane.tsx`
