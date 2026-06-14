---
name: Memory graph pane scope lock
overview: 聊天窗格侧栏记忆图谱按当前窗格锁定分区，隐藏用户/元智能体/分身/群聊切换 Tab。
todos:
  - id: t1-sidebar-lock
    content: sidebar 布局隐藏 scope Tab 并展示当前分身/群聊名
    status: completed
isProject: false
---

# Memory Graph：窗格侧栏分区锁定

**Plan-Id**: 2026-06-14-memory-graph-pane-scope-lock
**Plan-File**: `.cursor/plans/2026-06-14-memory-graph-pane-scope-lock.plan.md
**Made-with**: Damon Li

## 需求

- FR-1: 从分身/元智能体/群聊窗格打开记忆图谱时，仅展示该窗格对应分区数据。
- FR-2: 侧栏模式不展示四 Tab 切换器；设置页 dashboard 仍保留全量切换。
- AC-1: `MemoryGraphPanel` 按 `avatarId` 推导 `initialScope` 并传入 `contextTitle`。

## 改动文件

- `desktop/src/components/memory/MemoryGraphPanel.tsx`
- `desktop/src/components/memory/MemoryGraphExplorer.tsx`
