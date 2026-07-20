# Session Task Artifacts（任务产物接线）

Planned-with: cursor-grok-4.5-high-fast  
Suggested-Impl-Model: cursor-grok-4.5-high-fast

## Goal

右侧工作台「任务摘要 → 任务产物」展示本会话生成的文件；聊天内点击保存路径时聚焦任务产物，不再打开「工作区」Tab（文件浏览已在左侧导航「文件管理」）。

## Root cause

1. `WorkPanel` 任务产物区为 v1 空态占位（`EmptyBlock`「暂无产物」），未绑定任何数据源。
2. `revealFileInTaskspace` → `openWorkspaceFilePreview` 强制 `setWorkPanelFocus({ kind: "workspace" })`，与左侧「文件管理」功能重叠。

## In scope

- 从当前窗格消息提取产物路径：`file_write` / `file_edit` 的 `toolArgs.path` 与 `OK: wrote|edited`；`bash_exec` 重定向目标（仅作候选，展示前不强制磁盘校验）；助手正文中「保存路径」类标注的绝对路径；子智能体 `outputFiles` / `resultFile`
- `WorkPanel` 任务产物列表 UI（文件名 + 路径；打开 / 在文件夹中显示）
- 路径点击：打开工作台 → 任务摘要 → 任务产物并高亮；目录用系统文件管理器打开；**不**切换工作区 Tab
- 更新路径按钮 tooltip 文案

## Out of scope

- 删除工作区 Tab / 左侧文件管理
- 待办 / 参考信息真实数据源
- 后端 `session.artifacts` 持久化改造
- 任务产物区内完整编辑器预览（v1 用系统打开 / 访达定位）

## Key files

- `desktop/src/utils/session-artifacts.ts`（新建）
- `desktop/src/utils/session-artifacts.test.ts`（新建）
- `desktop/src/components/work-panel/SessionArtifactList.tsx`（新建）
- `desktop/src/components/work-panel/WorkPanel.tsx`
- `desktop/src/components/ChatPane.tsx`（`revealFileInTaskspace`）
- `desktop/src/components/messages/markdown-components.tsx`（tooltip）

## AC

1. 会话内 `file_write` 成功写入后，「任务产物」列出对应绝对路径，不再长期「暂无产物」
2. 点击聊天中的绝对路径 /「保存路径」链接：右侧打开任务摘要并展开任务产物，**不**出现工作区 Tab
3. 点击目录路径：系统文件管理器打开该目录；非 HTML 文件：任务产物高亮 + 访达定位（不 shell-open）
4. 子智能体 `outputFiles` 出现在同一任务产物列表（去重）
5. 点击 `.html`/`.htm`：在工作台「浏览器」Tab 内嵌预览（地址栏显示 `file://…`，srcDoc 渲染），**不**打开系统 Chrome
