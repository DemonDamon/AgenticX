# Near 桌面端：全局电脑搜索（侧栏搜索框 + Spotlight 面板）

> Plan-Id: 2026-05-25-near-global-search
> Plan-File: .cursor/plans/2026-05-25-near-global-search.plan.md
> Owner: Damon
> 状态：草拟，等待开工确认

## 背景与需求

参照用户提供的图 2（Near 侧栏顶部「Near v0.2.0」+「分身(11)」），希望在**应用品牌行与「分身」标题行之间**新增一条 **搜索入口**（与图 1 中“搜索 + 全局检索面板”一致）。

点击搜索框打开一个**全局电脑搜索面板**：
- 顶部搜索输入框（支持中文输入法 composition）
- 分类 tab：综合 / 文档 / 应用 / 图片 / 文件夹 / 视频
- 左侧搜索结果列表（按分组：文件夹 / 其他 …）
- 右侧文件预览（文本预览 / 元信息 / 「打开」「所在位置」按钮）

参照图来源（夸克网盘 PC 客户端）的「一键授权 体验文档全文搜索 / 图片智能搜索」属于增值能力，本期**不做**全文检索 / 图片语义搜索，仅做基于文件名 + 路径的本机文件检索。

> 严格遵守 `no-scope-creep`：本 plan 只新增**侧栏搜索入口 + 全局搜索面板 + 必要的 IPC**，不重构现有 AvatarSidebar 其它逻辑，不改 KB / Session FTS 现有行为。

## 范围（In Scope）

- FR-1 侧栏插入搜索条
  - 位置：`AvatarSidebar.tsx` 中「品牌按钮（Near vX.Y.Z）」与「分身 (N) + 新建」之间。
  - 视觉：圆角、占满侧栏宽度，左侧搜索图标 + 灰色 placeholder「搜索」，hover/focus 边框使用主题 token（`bg-surface-card` / `border-border-subtle` / `focus:ring`）。
  - 交互：点击或聚焦后打开全局搜索面板（不在侧栏内联展开，避免挤压 avatar 列表）。
  - 快捷键：⌘K / Ctrl+K 在 Near 主窗口任意位置打开同一面板。
- FR-2 全局搜索面板（GlobalSearchPanel）
  - 模态浮层（居中 / 顶部偏上），可 Esc / 点击遮罩关闭，遮罩使用 `bg-black/40` 而非毛玻璃以保证可读。
  - 顶部搜索输入；下方分类 tab（综合 / 文档 / 应用 / 图片 / 文件夹 / 视频）+ 计数；
  - 左列结果（按分组：文件夹 / 文档 / 应用 / 图片 / 视频 / 其他）；
  - 右列预览：文本/Markdown/源码取前 N KB 直显；图片以 file:// 缩略图显示；其他类型显示类型 + 大小 + 路径 + mtime。
  - 文案需中文化，符合 AGENTS.md 偏好。
- FR-3 主进程 IPC `system-search`
  - macOS：`mdfind -name <query>`（默认）；按类别用 `-onlyin` 或 `kMDItemContentTypeTree` filter（如 `public.image`、`public.movie`、`com.apple.application-bundle`）。
  - Windows：优先调用 `Everything` CLI（`es.exe`）若存在；fallback `dir /s /b` + 路径过滤；进一步 fallback 提示用户安装 Everything。
  - Linux：优先 `fd`，fallback `locate`；都不可用时降级到 `find $HOME -name`（限制深度与超时）。
  - 统一返回 `{ path, name, ext, kind, size, mtime }[]`；限制 200 条；带超时 5s；后台运行子进程，UI 显示 spinner + 已耗时。
- FR-4 主进程 IPC `system-search:preview`
  - 仅在用户点选某条结果时按需读取；只读纯文本 / 常见源码 / `.md` 前 64KB；图片直接走 `file://` URL；二进制不读内容。
  - 防御：拒绝读取超过 5MB 的文件；过滤 `node_modules / .git / .Trash` 等噪声目录默认折叠（开关可放第二期）。
- FR-5 主进程 IPC `system-search:open` / `:reveal`
  - `shell.openPath(path)` 打开；`shell.showItemInFolder(path)` 在访达 / 资源管理器中定位。
- FR-6 状态隔离与持久化
  - 最近 5 条搜索历史持久化到 `localStorage`，键名 `near:global-search:history-v1`；面板再次打开默认聚焦输入并展示历史。
  - 不与会话 / 知识库 / 跨会话 FTS 检索复用任何 store；本面板**完全独立**。

## 非范围（Out of Scope，避免 scope creep）

- 文档全文检索（PDF/Word 内容）— 与现有 KB 系统职责不重叠；本期只做文件名 + 路径匹配。
- 图片语义/OCR 搜索。
- 索引常驻进程；本期完全依赖系统已有索引（mdfind / Everything / locate db）。
- 修改 KB 检索 UI、跨会话 FTS UI、历史会话搜索 UI（已存在）。
- 修改 AvatarSidebar 其它分区（群聊 / 自动化任务 / 历史折叠等）。

## 技术方案

### 渲染层

- 新增 `desktop/src/components/global-search/GlobalSearchTrigger.tsx`：侧栏内的搜索输入框（实际是一个 button + 假 input 视觉），点击/聚焦/⌘K 触发 `openGlobalSearch()`。
- 新增 `desktop/src/components/global-search/GlobalSearchPanel.tsx`：浮层主体；内部组件 `CategoryTabs` / `ResultList` / `PreviewPane`。
- 新增 hook `desktop/src/hooks/useGlobalSearch.ts`：管理 query / category / results / selectedPath / loading / error / history；内部对 query 做 300ms debounce，依赖 `window.api.systemSearch({ query, category })`。
- store 改动**极小**：仅在 `desktop/src/store.ts` 加 `globalSearchOpen: boolean` + `openGlobalSearch / closeGlobalSearch`；或纯本地 `useState` + 通过自定义事件触发，避免污染全局 store（倾向后者）。
- 接入 `App.tsx`：监听 `keydown` 注册 ⌘K / Ctrl+K；渲染 `<GlobalSearchPanel />`。
- 在 `AvatarSidebar.tsx` 第 ~737 行 `</button>`（品牌按钮闭合）与第 ~739 行 `flex-1 flex flex-col py-1 min-h-0` 之间插入 `<GlobalSearchTrigger />`，仅占用 ~36px 高度。

### 主进程层

- 新增 `desktop/electron/system-search.ts`：导出 `runSystemSearch(query, category)` / `previewFile(path)` / `openPath` / `revealInFolder`。
  - 平台分支封装；子进程统一 `child_process.spawn`，stdout 流式聚合，5s 超时 `kill`。
  - macOS 类别映射：
    - 文档 `kMDItemContentTypeTree == 'public.content'`（或退一步限定 .md/.txt/.pdf/.doc/.docx/.ppt/.pptx/.xls/.xlsx）
    - 应用 `kMDItemContentType == 'com.apple.application-bundle'`
    - 图片 `kMDItemContentTypeTree == 'public.image'`
    - 视频 `kMDItemContentTypeTree == 'public.movie'`
    - 文件夹 `kMDItemContentType == 'public.folder'`
- `desktop/electron/main.ts` 注册 IPC：`system-search`, `system-search:preview`, `system-search:open`, `system-search:reveal`。
- `desktop/electron/preload.ts` + `desktop/src/global.d.ts` 暴露 `window.api.systemSearch / previewFile / openPath / revealInFolder`，并加 TS 类型。

### 异常 & UX 防御

- 空结果：「无匹配文件」+ 提示降级方案（如 Windows 未装 Everything 时提示）。
- 超时：「搜索超时（5s），尝试缩小关键词」。
- 错误：toast 显示 stderr 摘要，**不**仅显示 `'KeyError' / 'Errno 2'` 单 token（对齐 AGENTS.md 偏好）。
- 不在搜索期间阻塞 UI；面板内 spinner + 当前耗时计时。

## 任务拆解（按 P0 → P1 推进，每段独立可验收）

### P0-1 主进程能力（系统搜索 + 预览 + 打开）
- [ ] 新建 `desktop/electron/system-search.ts`；实现 macOS `mdfind`、Windows `where`/`Everything` 探测 + fallback、Linux `fd`/`locate` fallback。
- [ ] 在 `desktop/electron/main.ts` 注册 4 个 IPC handler。
- [ ] 在 `desktop/electron/preload.ts` + `desktop/src/global.d.ts` 暴露 typed API。
- AC：在 macOS dev 模式下，主进程 `ipcMain.handle('system-search', ...)` 能在 5s 内返回 ≤200 条。

### P0-2 侧栏搜索入口 + 浮层骨架
- [ ] 新建 `GlobalSearchTrigger.tsx` 并插入 `AvatarSidebar.tsx` 指定位置（不改其它逻辑）。
- [ ] 新建 `GlobalSearchPanel.tsx` 最简版：输入框 + 结果列表（仅 path/name），Esc / 遮罩关闭。
- [ ] 在 `App.tsx` 注册 ⌘K / Ctrl+K 打开面板（已聚焦输入时不抢焦）。
- AC：点击侧栏搜索框 / 按 ⌘K，浮层打开；输入关键字后 300ms 后展示文件列表。

### P0-3 分类 tab + 预览面板 + 操作按钮
- [ ] `CategoryTabs`：综合 / 文档 / 应用 / 图片 / 文件夹 / 视频，命中数量徽标。
- [ ] `PreviewPane`：文本/Markdown/源码 64KB 直显（带 monospace 字体）；图片走 `file://` 缩略图；其他类型展示元数据 + 类型图标。
- [ ] 「打开」「所在位置」按钮（调用 `shell.openPath` / `shell.showItemInFolder`）。
- AC：选中一条文档，右侧能展示前 64KB 文本；选中图片能看到缩略图；「所在位置」能在 Finder 中正确定位。

### P1-1 视觉与文案打磨
- [ ] 中文化全部 UI 文案；与 AGENTS.md 偏好一致（如「无匹配文件」「搜索超时（5s），请缩小关键词」）。
- [ ] 浮层视觉对齐 SettingsPanel：圆角、阴影、tokens；遮罩 `bg-black/40` 不加毛玻璃，避免主体发糊。
- [ ] 搜索框 hover/focus ring 使用主题 token；不引入额外蓝色硬编码。
- [ ] 「最近搜索」5 条历史 + 一键清空。

### P1-2 健壮性 / 边界
- [ ] 5s 超时 + kill 子进程，防止 `mdfind` 卡死。
- [ ] 频繁输入时 cancel 上一次 inflight 请求（通过递增 reqId 丢弃过期结果）。
- [ ] Windows 无 Everything 时给出明确「未检测到 Everything，已使用慢速 fallback；建议安装 Everything 获得更快搜索」。

## 验收（Acceptance Checklist）

- AC-1 侧栏「Near v0.2.0」下方新增一条搜索输入；与「分身 (N)」之间间距视觉协调，未挤压 avatar 列表（DMG 与 `npm run dev` 一致）。
- AC-2 ⌘K 在主窗口任意位置打开同一面板；Esc 关闭。
- AC-3 macOS 下输入 `Work` 能在 2s 内返回相关结果，分类切换到「文档」「图片」结果显著不同。
- AC-4 选中结果右侧预览（文本前 64KB / 图片缩略图 / 通用元信息）符合预期。
- AC-5 「打开」「所在位置」均正确调用系统行为。
- AC-6 未引入 lint / typecheck 报错；不破坏现有 AvatarSidebar 其它功能（分身列表、群聊、自动化任务、历史折叠均回归）。
- AC-7 commit 使用 `Made-with: Damon Li` + `Plan-Id` / `Plan-File` trailer。

## 风险与待确认

- R-1 Windows 全文 / 系统索引能力差异较大；若未装 Everything，fallback 速度可能较慢，本期接受「降级提示」体验。
- R-2 mdfind 在新装系统首次索引未完成时可能返回空，需 UI 友好提示。
- Q-1 是否需要在搜索面板里**同时**搜索 Near 自身资源（会话标题、分身名、KB 文档等）？本期建议**不混入**，与「电脑全局搜索」语义保持纯净；如需要后续单开 Plan。
- Q-2 ⌘K 是否与现有快捷键冲突？需在实现前快速 grep 一次确认。
