# 2026-03-29 Pane Drag-and-Drop Reorder

## Goal

在 Machi Desktop 中支持通过标题栏拖拽重排聊天窗格顺序，提升多窗格场景下的布局可控性。

## Scope

- 依赖：`@dnd-kit/core`、`@dnd-kit/sortable`、`@dnd-kit/utilities`。
- `store.ts`：`reorderPanes(fromIndex, toIndex)`；新建窗格补齐 `sessionTokens` 与 `ChatPane` 类型一致。
- `PaneManager.tsx`：`DndContext` + `SortableContext` + `rectSortingStrategy`；单窗格不启用 DnD；`DragOverlay` 预览；`onDragCancel` 清理状态；drop 后重置 `colSizes` / `rowSizes`。
- `SortablePaneWrapper.tsx`、`pane-sortable-context.tsx`：`useSortable` 与标题栏 listeners 透传。
- `ChatPane.tsx`：标题栏拖拽热区、`GripVertical`、grab 光标与 tooltip。

## Out of Scope

- 修改 `PaneDivider` 调宽/高逻辑。
- 工作区/中间列等非 `panes` 布局的拖拽。

## Acceptance Criteria

- AC-1：≥2 个窗格时，从标题栏拖拽可交换顺序并持久反映在 `panes` 数组顺序中。
- AC-2：拖拽时有 overlay 与原位占位视觉反馈；取消拖拽时 overlay 正确消失。
- AC-3：单窗格不出现无意义的拖拽手柄行为。

## Verification

- `npm run build`（desktop）通过。
