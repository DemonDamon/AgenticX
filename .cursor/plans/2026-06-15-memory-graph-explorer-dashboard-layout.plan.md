---
name: Memory graph explorer dashboard layout
overview: 设置页记忆图谱 Dashboard 布局：统计横排顶栏、图例右上角、删除确认弹窗实底与间距、统计条中文化与顶栏色条。
todos:
  - id: t1-stats-top-bar
    content: 左侧竖向统计栏改为图谱上方横排 statsBar
    status: completed
  - id: t2-legend-top-right
    content: 图例从画布底部移入右上角竖排卡片
    status: completed
  - id: t3-delete-modal
    content: 批量删除确认弹窗按钮 gap-3 + surface-base-fallback 实底
    status: completed
  - id: t4-stats-i18n-accent
    content: Episodes 改「记忆片段」；accent 色条改格子顶部横条
    status: completed
isProject: false
---

# Memory Graph Explorer：Dashboard 布局与确认弹窗 UX

**Plan-Id**: 2026-06-15-memory-graph-explorer-dashboard-layout
**Plan-File**: `.cursor/plans/2026-06-15-memory-graph-explorer-dashboard-layout.plan.md`
**Made-with**: Damon Li

## 背景

设置 → 记忆管理 → 元智能体/分身/群聊 的 Dashboard 模式（`MemoryGraphExplorer layout="dashboard"`）原布局为左侧 160px 竖向统计栏 + 底部图例，图谱可视区域偏窄；批量删除 Episode 确认框 footer 无 flex 间距且 `surface-panel` 半透明，底层统计数字会透出。

## 需求

### FR-1 统计顶栏横排（P0）
- 移除 `leftRail` 竖栏。
- 在中心图谱区顶部展示横排 `statsBar`：节点、关系、记忆片段、队列、分区。
- 各格之间竖线分隔，窄屏可换行。

### FR-2 图例移入画布右上角（P0）
- 删除画布下方独立 `legend` 行。
- 在 `canvasArea` 内 `absolute right-2 top-2` 竖排展示：实体 / Episode / 社区 / 已失效关系。
- 左上角保留「显示近期/高频片段，非完整记忆」提示，避免与图例重叠。

### FR-3 删除确认弹窗（P0）
- Episode 批量删除与「立即清理」确认框 footer 使用 `flex justify-end gap-3`。
- 面板 `panelClassName` 使用 `bg-[var(--surface-base-fallback)]`，遮罩 `bg-black/70`。
- 取消按钮 `bg-surface-card-strong`，避免 ghost 透底。

### FR-4 统计条文案与色条（P1）
- `Episodes` 标签改为中文「记忆片段」（副标题仍为「时间轴条目」）。
- 各统计格 accent 由左侧竖条改为顶部横条（`inset-x-3 top-0 h-[2px]`）。
- 分区格统一复用 `StatChip`（`mono` 等宽字体展示 `groupId`）。
- 中文标签移除 `uppercase`。

## 验收（AC）

- AC-1: Dashboard 模式无左侧统计竖栏，图谱区域横向更宽。
- AC-2: 图例位于力导向图右上角，不在画布下方。
- AC-3: 批量删除确认时「取消」「删除」有可见间距，不透过按钮看到后方统计数字。
- AC-4: 顶栏第三格显示「记忆片段」，五色条均在各格顶部。

## 改动文件

- `desktop/src/components/memory/MemoryGraphExplorer.tsx`

## 关联提交

| Commit | 说明 |
|--------|------|
| `e2f27905` | FR-1 / FR-2 统计顶栏横排 + 图例右上角 |
| `250ffad9` | FR-3 删除确认弹窗间距与不透明背景 |
| `b0da71fa` | FR-4 记忆片段中文化 + 顶栏色条 |

## 非目标

- 不改侧栏模式（`layout="sidebar"`）布局。
- 不改后端 memory graph API 或删除逻辑（见 `2026-06-15-memory-graph-rebuild-delete` plan）。
