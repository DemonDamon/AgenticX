# 左侧栏历史对话（Sidebar Session History）

Planned-with: grok 4.5 medium  
Suggested-Impl-Model: composer-2.5

## Goal

在 `AvatarSidebar` 主导航下方填入「历史对话」区，视觉与交互对齐已确认 mockup：微信 IM / 飞书 IM / 置顶 / 今天·更早；无头像、无条数；每行名字 chip；微信 IM 行右侧头像筛选；默认 20 条 +「显示更多」。

## Architecture

- 新建只读列表组件 `SidebarSessionHistory`，挂到 `AvatarSidebar` 的 `flex-1` 滚动区。
- 数据：`listSessions()` 全量（不按 pane avatar 过滤）+ `loadFeishuBinding` / `loadWechatBinding` 的 `_desktop.session_id`。
- 打开会话：按行 `avatar_id` 找/建窗格 → `setPaneSessionId` → 复用 `resolveSessionTailForSwitch` / LRU 缓存加载消息（与 `SessionHistoryPanel.switchSession` 同路径，但不改历史浮层）。
- **不改** `SessionHistoryPanel` 行为；窗格内浮层历史保留。

## In scope

- FR-1: 侧栏分区：微信 IM → 飞书 IM → 置顶 → 今天 → 更早
- FR-2: 行 UI：线框图标 + 名字 chip（无色点）+ 截断标题；无数量、无角色头像
- FR-3: 微信 IM 标题行右侧 `全部 ▾` 下拉，按分身筛选（全部 / Near / 各分身）；筛选项影响置顶与今天/更早；IM 绑定行始终可见（若绑定存在）
- FR-4: 今天+更早默认合计最多 20 条，点「显示更多」再 +20
- FR-5: 排除 `automation:*` 与 `archived`；IM 绑定会话不重复出现在置顶/日期组
- FR-6: 点击行乐观切到对应分身窗格 + session；订阅 `sessionCatalogRevision` 刷新；轻量轮询绑定（3s）与列表（可选 ~5s）

## Out of scope

- 侧栏内右键置顶/绑定/删除（仍用窗格历史浮层）
- 侧栏全文搜索
- 改后端 `/api/sessions` schema
- 重构 `SessionHistoryPanel` 抽公共组件（仅可抽极小纯函数到 util，若重复过多）

## Precise落点

| 文件 | 改动 |
|------|------|
| Create `desktop/src/components/sidebar/SidebarSessionHistory.tsx` | 分区 UI、筛选、More、点击打开 |
| Create `desktop/src/utils/sidebar-session-history.ts` | normalize / label / day buckets / avatar chip 名 |
| Modify `desktop/src/components/AvatarSidebar.tsx` | 用 `<SidebarSessionHistory />` 替换底部空 `flex-1` |

## AC

- AC-1: 冷启动后侧栏可见历史分区；有绑定则微信/飞书区出现对应会话
- AC-2: 置顶会话出现在 PINNED；非 IM 绑定的置顶不进日期组
- AC-3: 筛选「飞廉」后置顶/今天/更早仅飞廉；解绑筛选后恢复
- AC-4: >20 条时出现「显示更多」，点击后条数增加
- AC-5: 点击某行打开正确分身窗格并加载该 session 消息

## no-scope-creep

禁止顺手改 gallery、Settings、SessionHistoryPanel 布局文案英文化等无关项。
