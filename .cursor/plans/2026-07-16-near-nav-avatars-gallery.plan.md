# 子规划 B · 数字分身卡片墙（AvatarGalleryView）

Planned-with: claude-opus-4.8
Suggested-Impl-Model: claude-opus-4-8-thinking-medium

> 主规划：`.cursor/plans/2026-07-16-near-nav-redesign.plan.md`
> 依赖：子规划 A（`mainView` 状态、`usePaneNavigation` hook、`AvatarGalleryView` 空壳、`MainViewShell`）。
> 目标：把 A 的 `AvatarGalleryView` 空壳实现成参考图 6 的**分身卡片墙**，保留 Near 暗色极客品位。

---

## In scope
- 实现 `desktop/src/components/gallery/AvatarGalleryView.tsx`：
  - 顶部标题区（标题「数字分身」+ 一句副标题 + 「+ 新建分身」按钮）。
  - 响应式卡片网格，每张卡片展示分身头像/名称/角色描述 + 主操作按钮「唤起」。
  - 点击卡片任意处或「唤起」→ `usePaneNavigation().openMetaOrAvatarPane(avatar.id, avatar.name)`（等价旧侧栏点分身，含 session 恢复 + 切回聊天）。
  - 空态 / 加载态处理。
  - 内嵌 `AvatarCreateDialog`（从 A 迁来的 `createOpen` 挂载点），「+ 新建分身」打开它，创建成功后刷新分身列表。

## Out of scope
- 不改后端、不改 `usePaneNavigation` 打开逻辑。
- 不做分身右键菜单/编辑设置入口（`AvatarSettingsPanel` 仍由侧栏其它入口或后续增强承载；本视图只做「浏览 + 唤起 + 新建」）。若 A 阶段把 `AvatarSettingsPanel` 也迁移，则本视图可选加卡片右上角「设置」小按钮——**默认不加**，避免范围膨胀。
- 不做搜索/筛选（分身数量通常 <30，图 6 也无筛选）。可作未来增强。

---

## FR / 精确落点

### FR-B1 · 数据来源
- 分身列表：`useAppStore((s) => s.avatars)`（`Avatar` 类型见 store L61–78：`id/name/role/avatarUrl/pinned/...`）。
- 加载态：`useAppStore((s) => s.corePreloadAttempted)` + `avatars.length`（参照 AvatarSidebar L120–140 的 `avatarsLoaded` 判断，避免冷启动误显示「暂无分身」）。
- 排序：置顶分身（`pinned`）在前，其余按现状顺序（复用侧栏 `sortedAvatars` 排序逻辑，若该逻辑在 AvatarSidebar 内，抽一个小工具或就地实现相同规则）。
- 头像/首字母/色块：复用 `avatarInitials(name)` + `avatarBgClass(id)`（`desktop/src/utils/avatar-color.ts`）；有 `avatarUrl` 用 `<img>`，否则色块 + initials（与 AvatarSidebar L882–895 一致）。

### FR-B2 · 卡片墙 UI（参考图 6，Near 品位）
- 外层用 A 的 `MainViewShell`（可滚动、`px-6 py-5`）。
- 顶部标题区：
  ```
  数字分身
  为你的团队召集专精分身，点击卡片即可唤起对话。
  [+ 新建分身]（右上）
  ```
- 网格：`grid gap-3 grid-cols-1 sm:grid-cols-2 xl:grid-cols-3`（按主区宽度自适应；窄屏单列）。
- 每张卡片（暗色卡片，`rounded-xl border border-border bg-surface-card hover:bg-surface-card-strong hover:border-text-faint transition`，`p-4`）：
  - 左上：头像/色块（`h-11 w-11 rounded-[10px]`）+ 名称（`text-[15px] font-semibold text-text-strong`，`pinned` 加 `*` 或小星标）。
  - 角色描述：`avatar.role`，`line-clamp-2 text-xs text-text-muted`；无 role 时留白或用 systemPrompt 首行截断（可选，默认只用 role）。
  - 底部主操作：**「唤起」按钮**（`bg-btnPrimary text-btnPrimary-text ... hover:bg-btnPrimary-hover`，`text-xs font-medium rounded-md px-3 py-1.5`），可默认常显或 hover 显现——**默认常显**（暗色下更清晰，符合用户「操作按钮常驻」偏好）。
  - 若该分身已有打开的窗格（`panes.some(p => p.avatarId === avatar.id)`），卡片右上加一个绿点/「进行中」小标（复用 `bg-emerald-500` 语义，呼应旧侧栏 hasPane 绿点）。
- 整卡 `onClick` = 唤起；「唤起」按钮 `onClick` 需 `stopPropagation` 后同样调用打开（避免重复触发，二者行为相同即可，`stopPropagation` 防止冒泡二次）。

### FR-B3 · 打开与新建
- 打开：`const { openMetaOrAvatarPane } = usePaneNavigation();` 卡片/按钮 `onClick={() => void openMetaOrAvatarPane(avatar.id, avatar.name)}`（hook 内部会 `setMainView("chat")` 切回聊天）。
- 新建：本视图内 `const [createOpen, setCreateOpen] = useState(false);` + 挂载 `<AvatarCreateDialog open={createOpen} onClose={() => { setCreateOpen(false); /* 触发刷新 */ }} onCreate={handleCreate} />`。
  - `handleCreate` 复用现有创建逻辑（参照 AvatarSidebar `handleCreate` L379–408 → `window.agenticxDesktop.createAvatar({...})`）。创建后刷新：可派发 `window.dispatchEvent(new CustomEvent("agenticx:avatars:changed", { detail: { openPane: false } }))`（AvatarSidebar 已监听并 `refreshAvatars`，见 L519–534），或直接调用 `window.agenticxDesktop.listAvatars()` → `setAvatars`。**优先复用事件**以保持单一刷新路径。
  - 若 A 阶段已把 `AvatarCreateDialog` 留在 AvatarSidebar，则本视图改为派发一个「打开新建分身」事件由侧栏处理；**决策**：按 A 的 FR-A4 决策，`AvatarCreateDialog` 挂载迁到本视图，逻辑自洽，避免跨组件事件。

### FR-B4 · 空态 / 加载态
- 未加载完（`!avatarsLoaded`）：居中 `Loader2` 旋转 + 「正在加载分身…」。
- 加载完且 `avatars.length === 0`：居中空态卡片「还没有数字分身」+ 「+ 新建分身」CTA。

---

## 验收
- **AC-B1** 点侧栏「数字分身」→ 主区内联显示卡片墙（非弹窗），每张卡片有头像/名称/角色 + 「唤起」按钮。
- **AC-B2** 点任一卡片或其「唤起」→ 打开/聚焦该分身聊天窗格，主区切回聊天，session 恢复行为与旧侧栏点分身一致。
- **AC-B3** 已开窗格的分身卡片显示「进行中」绿点标记。
- **AC-B4** 「+ 新建分身」打开 `AvatarCreateDialog`，创建成功后墙内即时出现新卡片。
- **AC-B5** 冷启动加载态/空态文案正确，不误显「暂无分身」。
- **AC-B-BUILD** `cd desktop && npm run build` 通过；`ReadLints` 无新增错误。
- **AC-B-SMOKE** `AGX_DEV_PORT=5713 npm run dev`：切到分身墙、唤起、返回聊天、再切回墙，无控制台报错。

## 参考视觉
图 6（专家/分身卡片墙）为交互参照；Near 采用自身暗色卡片 + `avatar-color` 色系，不复刻其配色与「特邀专家」等标签。
