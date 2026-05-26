---
name: ""
overview: ""
todos: []
isProject: false
---

# Near 桌面端：全局搜索结果右键菜单

> Plan-Id: 2026-05-26-near-search-context-menu
> Plan-File: .cursor/plans/2026-05-26-near-search-context-menu.plan.md
> Owner: Damon
> 状态：草拟，等待开工确认
> 关联：`.cursor/plans/2026-05-25-near-global-search.plan.md`（基础全局搜索能力已落地）

## 背景与需求

全局搜索面板（`GlobalSearchPanel.tsx` + `useGlobalSearch.ts`）已可返回**文件 / 文件夹**结果，并支持 双击「打开」/「在 Finder 显示」。但目前**右键无上下文菜单**，相比 Marvis 缺少快速操作能力，且与 Near 自身的工作区 / 对话引用能力没有打通。

本 plan 仅新增「搜索结果行右键菜单」，不改其它视觉与搜索逻辑（严守 `no-scope-creep`）。

## 范围（In Scope）

按结果**类型**区分两套菜单项。共有 Marvis 风操作 + Near 特有操作：

### FR-1 文件夹右键菜单
- M-1 打开（在系统中打开该文件夹，相当于双击）
- M-2 在 Finder/资源管理器中显示
- M-3 复制路径
- M-4 复制名称
- M-5 显示简介 / 获取信息（macOS：`open -R` 或 AppleScript Get Info；Win/Linux：fallback 为「在文件管理器中显示」）
- N-1 **添加至工作区**（调用 `window.agenticxDesktop.addTaskspace`，作用于**当前激活窗格**的 session；若 session 不存在按 `WorkspacePanel` 现有规则提示）
- N-2 **引用至当前对话**（在当前激活 ChatPane 输入框光标处插入 `@file[<displayName>](<absolutePath>)` token，并保留 `sourcePath` 元数据，使后续 `context_files` 用绝对路径）
- N-3 **引用至新对话**（先在当前 pane 创建一个全新 session，再执行 N-2）

### FR-2 文件右键菜单
- M-1 打开（系统默认应用）
- M-2 在 Finder/资源管理器中显示
- M-3 复制路径
- M-4 复制名称
- M-5 显示简介
- M-6 用其他应用打开（macOS：`open -R` 后按 ⌘+鼠标右键 不可控；这里 fallback 仅做「在 Finder 显示」+ toast 提示「请在系统中右键选择打开方式」；Win 直接 `rundll32 shell32.dll,OpenAs_RunDLL`，Linux 暂不支持）
- N-1 **添加文件所在文件夹至工作区**（取 `path.dirname(file)` 调 `addTaskspace`，逻辑同 FR-1 N-1）
- N-2 **引用至当前对话**（同 FR-1 N-2，token 指向文件本身）
- N-3 **引用至新对话**（同 FR-1 N-3）

> 注：按用户要求，**不**提供「删除 / 重命名」（破坏性操作走系统文件管理器即可）。

### FR-3 触发与 UX
- 右键点击 `ResultRow` 任意位置弹出菜单；复用既有 `desktop/src/components/ContextMenu.tsx`（已有清单 / 自动避让视口、Esc / 点击外部关闭）。
- 视觉：与 `WorkspacePanel` 的 `ContextMenuItem` 一致（圆角、`hover:bg-surface-hover`、危险项 `danger=true` 红色——本期未启用，预留接口）。
- 在执行 N 系列引用类操作时，全局搜索面板执行成功后**自动关闭**（与现有「点搜索结果打开后关闭面板」语义一致），让用户立即看到对话或工作区变化。
- 在 N 系列「**新对话**」中：调用 `window.agenticxDesktop.createSession({ avatar_id, name })`，按当前 pane 已有 `paneAvatarId / paneAvatarName` 派发；session 准备好后再走 N-2 注入 token；失败时关闭菜单并 toast 报错。

## 非范围（Out of Scope）

- 不改 `useGlobalSearch.ts` 已有 query / category / preview 逻辑。
- 不新增搜索结果排序 / 过滤选项。
- 不动 `WorkspacePanel`、`ChatPane` 现有右键菜单与文件引用 token 渲染。
- 不引入「删除 / 重命名」破坏性操作。
- 不实现真正的「打开方式…」选择器（macOS 受限，跨平台代价高，本期只做退化引导）。

## 技术方案

### 渲染层

- 在 `desktop/src/components/global-search/GlobalSearchPanel.tsx` 中：
  - 给 `ResultRow` 增加 `onContextMenu` prop；将 `(item, x, y)` 上抛到面板组件层。
  - 面板层维护 `ctxMenu = { open, x, y, item } | null` state，渲染 `<ContextMenu />`。
  - 菜单项构造函数 `buildItems(item)` 根据 `item.kind === "folder"` 生成两套清单。
- 新增/复用 IPC（见下）。引用类操作通过两条**新 IPC 桥**派发到当前激活窗格：
  - `near:global-search:reference-file`（参数：`{ filePath, mode: "current" | "new" }`）
  - `near:global-search:add-to-workspace`（参数：`{ folderPath }`）
  - 这两个事件不走 Electron IPC，而是用浏览器 `CustomEvent` 在渲染进程内派发；监听在 `App.tsx` 顶层（已知当前激活的 `paneId`），由 `App.tsx` 调用 `addTaskspace` 或将 token 推到目标 `ChatPane`。
  - 若日后多窗格语义复杂，再切换为 zustand action，本期保持轻量。
- `ChatPane` 既有「@文件 token 插入」逻辑可复用：抽出最小工具函数 `insertFileMentionAtCursor(paneId, filePath, displayName)` 至 `desktop/src/utils/chat-input-tokens.ts`（如该文件不存在则新建，仅迁移**当前重复分散**的注入逻辑，不改语义）。**若代价超预期则降级为：在 App 层直接调用 ChatPane 暴露的 ref 方法**，二选一，实现阶段二选一记录到 commit。

### 主进程层（最小新增）

复用现有 IPC：
- `system-search:open` → 打开
- `system-search:reveal` → 在 Finder 显示
- `clipboard.writeText` 在渲染层直接 `navigator.clipboard.writeText(...)`，**无需新 IPC**

新增 IPC（仅当渲染层无法完成时）：
- `system-search:get-info`（macOS：`spawn("open", ["-R", path])` 已能在 Finder 选中；真正「显示简介」需 `osascript` 触发 `tell application "Finder" to open information window of POSIX file "..."`；非 macOS 退化为 reveal）
- 不新增 trash / rename / open-with，避免误用。

### 防御与异常

- 复制操作失败时给「操作失败」级别 toast，不抛栈。
- 「引用至新对话」如 `createSession` 失败：保留菜单关闭，提示原因并不打断用户当前会话。
- 「添加至工作区」复用 `WorkspacePanel.addTaskspace` 的现有错误路径（重复路径 / 无 session 等）。
- 当结果项 `path` 已不存在（被移动 / 删除）时，open / reveal 的失败由现有 IPC handler 报错；菜单本身不预校验。

## 任务拆解（P0 → P1）

### P0-1 菜单骨架与 Marvis 风通用项
- [ ] 在 `GlobalSearchPanel.tsx` 接入 `ContextMenu`，给 `ResultRow` 加 `onContextMenu`；阻止默认行为。
- [ ] 实现 M-1（打开）、M-2（reveal）、M-3（复制路径）、M-4（复制名称）。
- [ ] AC：在 macOS dev 下任意搜索结果右键菜单弹出；复制路径后 ⌘V 可粘贴；reveal 与现有双击行为一致。

### P0-2 显示简介（M-5）+「用其他应用打开」（M-6）退化
- [ ] macOS：新增 `system-search:get-info` IPC，调用 `osascript`；失败时回退到 `system-search:reveal`。
- [ ] Windows：M-6 调用 `rundll32 shell32.dll,OpenAs_RunDLL <path>`；M-5 退化为 reveal。
- [ ] Linux：M-5 / M-6 都退化为 reveal，并 toast 「当前平台不支持，已在文件管理器中定位」。
- [ ] AC：三平台菜单项不报错，行为符合上述说明。

### P0-3 Near 特有：添加至工作区（N-1）
- [ ] App 层监听 `near:global-search:add-to-workspace` CustomEvent，转调 `addTaskspace({ sessionId, path, label })`。
- [ ] 文件菜单走「父目录」；文件夹菜单走自身路径。
- [ ] AC：在搜索结果右键 → 添加至工作区，工作区面板出现该目录；重复添加给出「已存在」提示。

### P0-4 Near 特有：引用至当前对话 / 新对话（N-2/N-3）
- [ ] 抽出 / 复用 `insertFileMentionAtCursor`，确保插入 token 与 WorkspacePanel `@` 注入一致（保留 `sourcePath`，渲染为蓝色不可编辑 token）。
- [ ] 「引用至当前对话」：派发 CustomEvent，App 层调用激活 `ChatPane` 的注入函数。
- [ ] 「引用至新对话」：先 `createSession`（按 pane 的 `avatar_id`），等 `session_id` 返回后再注入。
- [ ] 引用成功后自动关闭全局搜索面板。
- [ ] AC：选一条 `.md` 文件 → 引用至当前对话，输入框光标处出现蓝色 `@文件名` token；发送后 `context_files` 含其绝对路径；新对话路径下，原对话不被污染。

### P1-1 健壮性与文案
- [ ] 复制 / get-info / reveal 的成功与失败 toast 文案中文化。
- [ ] 菜单按钮顺序与分组：Marvis 风（打开 / 在 Finder 显示 / 显示简介 ｜ 复制路径 / 复制名称 ｜ 用其他应用打开）+ 分隔线 + Near 特有项。
- [ ] AC：菜单项视觉与 `WorkspacePanel` 右键菜单一致；分隔线在 Marvis 项与 Near 项之间。

## 验收（Acceptance Checklist）

- AC-1 文件夹结果右键菜单包含 5 项 Marvis + 3 项 Near 共 8 项；文件结果包含 6 项 Marvis（含 M-6 退化）+ 3 项 Near 共 9 项。
- AC-2 「添加至工作区」对文件夹 / 文件两套语义生效（文件用其父目录），并能在 `WorkspacePanel` 中立即看到。
- AC-3 「引用至当前对话」插入 token 与现有 `@文件` token 完全一致；可被发送 / 重试 / 删除单独引用。
- AC-4 「引用至新对话」创建新 session 后，原会话不出现该 token，新会话输入框出现 token。
- AC-5 macOS 「显示简介」实际打开 Finder 信息窗口；Win/Linux 退化为 reveal 且有 toast。
- AC-6 全部右键操作不破坏既有双击 / Enter 行为；面板视觉与上一版一致。
- AC-7 通过 `npm run dev` 与 DMG 打包路径双验证；无 lint / typecheck 报错。
- AC-8 commit 使用 `Made-with: Damon Li` + `Plan-Id` / `Plan-File` trailer。

## 风险与待确认

- R-1 macOS `osascript` 触发「显示简介」在部分用户系统受隐私权限限制；首次调用可能弹权限申请，必要时退化为 reveal。
- R-2 「引用至新对话」若当前 pane 是 `automation:*` 或群聊会话，逻辑不应走「自动建分身 session」；该路径走 `WorkspacePanel.addTaskspace` 同款守卫即可，本期沿用其错误提示。
- Q-1 是否需要在右键菜单中再加「复制为 Markdown 链接」（`[name](file://path)`）？本期**不做**，等用户实际场景出现再加。
- Q-2 是否需要在引用类操作上提供二次确认？默认**不要**，避免打断；如用户反馈误点频繁再加。
