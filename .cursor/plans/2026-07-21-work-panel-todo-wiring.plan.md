# Work Panel 待办接线

Planned-with: cursor-grok-4.5  
Suggested-Impl-Model: cursor-grok-4.5

## Goal

将右侧工作台「任务摘要 → 待办」从 v1 空态占位接到真实 `todo_write` 快照，与主区 StickyTaskBar「任务进度」同源。

## Root cause

`.cursor/plans/2026-07-19-work-panel-expand.plan.md` 明确把「待办真实数据源」标为 Out of scope；`WorkPanel.tsx` 硬编码 `hasContent={false}` + 永远渲染「暂无待办」。

## In scope

- 抽取 `pickLatestTodoFromMessages` 到 `TodoUpdateCard.tsx`，`StickyTaskBar` 改用共享函数
- `WorkPanel` 从 `paneMessages` 解析最新 todo；应用 `isTodoSnapshotSuperseded` 与 ghost-list 守卫（与 StickyTaskBar 一致）
- 有数据时展示 N/M + 清单；有内容时 Trae 式自动展开分区
- 新建 `SessionTodoList.tsx` 渲染条目

## Out of scope

- 不改 `todo_write` 后端 / 工具契约
- 不向 WorkPanel 透传 liveness / resume 控件（侧栏只读展示）
- 不改 StickyTaskBar 视觉与行为语义（除共享 picker）

## Key files

- `desktop/src/components/TodoUpdateCard.tsx` — `pickLatestTodoFromMessages`
- `desktop/src/components/StickyTaskBar.tsx` — 改用共享 picker
- `desktop/src/components/work-panel/SessionTodoList.tsx` — 新建
- `desktop/src/components/work-panel/WorkPanel.tsx` — 待办区接线

## Trae Work 语义（2026-07-22 补）

侧栏对齐 Trae Work，**不同于** StickyTaskBar：

| 场景 | 侧栏「待办」 | StickyTaskBar（输入区上） |
|------|-------------|---------------------------|
| 同轮多次 todo_write | 展示最新快照，状态就地更新 | 同左 |
| 用户发下一轮、尚无新 todo_write | **继续展示上一轮清单**（不空） | 因 superseded 隐藏，避免幽灵卡 |
| 新一轮写出新 todo_write | **整栏替换（reset）**，不累积旧项 | 展示新清单 |

实现：侧栏只用 `pickLatestTodoFromMessages`，**不**套 `isTodoSnapshotSuperseded` / ghost `hasAnyProgress`。

## AC

1. 会话存在任意有效 `todo_write` 时，侧栏「待办」展示最新条目与 N/M，不再「暂无待办」
2. 同轮内 todo 状态随后续 `todo_write` 更新；新一轮新清单整栏替换，不拼接历史
3. 用户已发下一轮但尚未出现新 `todo_write` 时，侧栏仍显示上一轮清单（不闪空）
4. 有 todo 时「待办」分区自动展开；数量角标为 total
5. StickyTaskBar 仍可在 superseded 时隐藏（作曲区语义不变）
