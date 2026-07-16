# 子规划 A · 导航地基（mainView 状态 + usePaneNavigation + 侧栏按钮化 + 主区路由）

Planned-with: claude-opus-4.8
Suggested-Impl-Model: gpt-5.6-terra-medium

> 主规划：`.cursor/plans/2026-07-16-near-nav-redesign.plan.md`
> 本子规划是地基，B/C/D 均依赖它。目标：搭好「按钮导航 + 主区视图路由」骨架，抽出可复用的窗格导航 hook，并为 B/C/D 建好空壳视图组件（可独立编译运行、行为不回退）。

---

## In scope
1. store 新增 `mainView` 状态与 `setMainView`（默认 `'chat'`）。
2. 新增 `desktop/src/hooks/usePaneNavigation.ts`，把 `AvatarSidebar` 里的 `openOrFocusPane` / `openOrFocusGroupPane` / `openOrFocusAutomationPane` **等价迁移**进来，并新增 `newMetaTask()`；每个「打开窗格」动作末尾 `setMainView('chat')`。
3. 新增 new-topic 事件通道：`ChatPane` 监听 `agenticx:pane:new-topic`（按 paneId 匹配）调用现有 `createNewTopic(false)`。
4. 改造 `AvatarSidebar`：移除分身/群聊/定时三段列表，改为 4 个按钮导航（保留品牌行 + 全局搜索），按钮高亮跟随 `mainView`。
5. 改造 `App.tsx` `agx-main-content`：按 `mainView` 路由到 `PaneManager` / `AvatarGalleryView` / `ProjectsView` / `AutomationView`。
6. 创建 B/C/D 三个**空壳视图组件**（占位文案，后续子规划填充），保证 A 单独可编译、可运行。

## Out of scope
- 不实现卡片墙/项目页/定时页的真实内容（分别在 B/C/D）。
- 不动后端、不动 `PaneManager`/`ChatPane` 对话主逻辑（除新增一个事件监听）。
- 不新增侧栏「最近任务列表」。

---

## FR / 精确落点

### FR-A1 · store 新增 `mainView`
文件：`desktop/src/store.ts`

- 在类型定义区（`avatars`/`activeAvatarId` 附近，参考 L474–485 的 state 字段块）新增：
  ```ts
  export type MainView = "chat" | "avatars" | "groups" | "automation";
  ```
  并在 store 接口里加字段与 action（放在 `activePaneId: string;`（L485）之后）：
  ```ts
  mainView: MainView;
  setMainView: (view: MainView) => void;
  ```
- 初始值：在初始 state（`panes: [makeDefaultPane()]` / `activePaneId: "pane-meta"`，约 L980–981）附近加 `mainView: "chat",`。
- action 实现（放在 `setActivePaneId` 实现附近，约 store L1252）：
  ```ts
  setMainView: (view) => set({ mainView: view }),
  ```
- **AC-A1**：`useAppStore.getState().mainView === "chat"`（默认）；`setMainView("avatars")` 后为 `"avatars"`。typecheck 通过。

### FR-A2 · 抽取 `usePaneNavigation` hook
新文件：`desktop/src/hooks/usePaneNavigation.ts`

将 `AvatarSidebar.tsx` 中以下三个函数**逐行等价搬移**（保留 remembered-session 恢复、`listSessions` 兜底、`pickMostRecentSessionId`、`openingRef` 防抖等全部行为，不得简化）：
- `openOrFocusPane(avatarId, avatarName)` → 导出为 `openMetaOrAvatarPane(avatarId, avatarName)`
- `openOrFocusGroupPane(group)` → `openGroupPane(group)`
- `openOrFocusAutomationPane(task)` → `openAutomationPane(task)`

hook 形态：
```ts
export function usePaneNavigation() {
  const panes = useAppStore((s) => s.panes);
  const addPane = useAppStore((s) => s.addPane);
  const setActivePaneId = useAppStore((s) => s.setActivePaneId);
  const setActiveAvatarId = useAppStore((s) => s.setActiveAvatarId);
  const setPaneSessionId = useAppStore((s) => s.setPaneSessionId);
  const setMainView = useAppStore((s) => s.setMainView);
  // ... openingRef via useRef
  const openMetaOrAvatarPane = useCallback(async (avatarId, avatarName) => { /* 迁移自 openOrFocusPane */ setMainView("chat"); }, [...]);
  const openGroupPane = useCallback(async (group) => { /* 迁移 */ setMainView("chat"); }, [...]);
  const openAutomationPane = useCallback(async (task) => { /* 迁移 */ setMainView("chat"); }, [...]);
  const newMetaTask = useCallback(() => { /* 见 FR-A3 */ }, [...]);
  return { openMetaOrAvatarPane, openGroupPane, openAutomationPane, newMetaTask };
}
```
- 依赖工具从原 import 迁移：`getRememberedSessionForAvatar`、`pickMostRecentSessionId`（把这个纯函数也移到 hook 文件或独立 util，AvatarSidebar 若不再用则删对应 import）。
- **关键**：每个 open 动作在**成功聚焦/创建 pane 后**调用 `setMainView("chat")`，确保从卡片墙/项目页点击后主区切回聊天。
- **AC-A2**：`AvatarSidebar` 与新视图都通过该 hook 打开窗格；点分身/群聊/定时窗格的 session 恢复行为与改造前完全一致（手测：点一个曾有会话的分身 → 恢复到最近会话而非空会话）。

### FR-A3 · 「新建任务」= 元智能体全新会话
- hook 内 `newMetaTask()` 实现：
  1. `setMainView("chat")`
  2. 找到/聚焦元智能体窗格：`const meta = panes.find(p => p.avatarId === null) ?? undefined;` 若存在 `setActivePaneId(meta.id)`，否则 `addPane(null, META_AGENT_DISPLAY_NAME, "")` 并聚焦。（元窗格固定 id `pane-meta`，见 store L768）
  3. `window.dispatchEvent(new CustomEvent("agenticx:pane:new-topic", { detail: { paneId: metaPaneId } }))`
- `ChatPane.tsx`：新增一个 effect 监听该事件（放在其它 window 事件监听附近），当 `detail.paneId === pane.id` 时调用已有 `createNewTopic(false, pane.sessionMode ?? "daily_office")`（L9297）：
  ```ts
  useEffect(() => {
    const onNewTopic = (e: Event) => {
      const detail = (e as CustomEvent).detail as { paneId?: string } | undefined;
      if (detail?.paneId && detail.paneId !== pane.id) return;
      if (detail?.paneId === pane.id) createNewTopic(false, pane.sessionMode ?? "daily_office");
    };
    window.addEventListener("agenticx:pane:new-topic", onNewTopic);
    return () => window.removeEventListener("agenticx:pane:new-topic", onNewTopic);
  }, [pane.id, pane.sessionMode]);
  ```
  注意 `createNewTopic` 是组件内闭包函数，effect 依赖需能拿到最新引用（用 ref 或把 effect 放在 `createNewTopic` 定义之后；若有 TDZ/依赖问题，改用 `createNewTopicRef.current` 模式，参照文件内既有 `resumeInNewSessionRef` 写法 L9317）。
- **AC-A3**：点「新建任务」→ 元窗格清空历史、`sessionId` 置空、`isPaneAwaitingFreshSession(pane-meta)` 为 true；输入首条消息可正常发送并创建新会话（不排队进旧流）。

### FR-A4 · 侧栏改 4 按钮
文件：`desktop/src/components/AvatarSidebar.tsx`

- **删除**：分身分组（L826–915）、分身/群聊间 resizer（L917–925）、群聊分组（L928–999）、群聊/定时间 resizer（L1001–1009）、定时分组（L1011–…）的整段列表 JSX，及仅服务于这些列表的 state / effect / 右键菜单 / 轮询（`automationTasks`、`runningTaskIds`、`avatarsCollapsed`/`groupsCollapsed`/`automationCollapsed`、`*Height` 拖拽 state、`sidebar-section-heights` import、context menu 相关，`openOrFocus*` 已迁到 hook）。**只删与三段列表强绑定的代码，不得误删品牌行、全局搜索、`AvatarCreateDialog`、`AvatarSettingsPanel`、`refreshAvatars/refreshGroups` 触发逻辑等仍需保留的部分**（no-scope-creep）。
  - 注意：`refreshAvatars`/`refreshGroups`/分身变更事件监听（`agenticx:avatars:changed` L519–534）仍要保留，因为分身墙/项目页依赖 store 里的 `avatars`/`groups` 数据保持新鲜；App.tsx 已有兜底 fetch，但侧栏的刷新监听是主路径，保留。
  - 「新建分身」入口：现由分身分组头部「+ 新建」触发 `setCreateOpen(true)`。分身列表移除后，将「新建分身」入口迁到**分身卡片墙**（子规划 B 的墙内「+ 新建分身」）；本子规划中 `AvatarCreateDialog` 及 `createOpen` state 仍保留在 AvatarSidebar，或一并迁到 B。**决策**：`AvatarCreateDialog` 保留在 AvatarSidebar（挂载不依赖列表），B 视图通过 hook/事件触发打开——为简化，A 阶段先在导航按钮区不放「新建分身」，由 B 在墙内自带新建对话框。相应地把 `AvatarCreateDialog` 挂载与 `createOpen` 迁到 B 的 `AvatarGalleryView`。
- **新增**：4 个按钮导航区，插在 `GlobalSearchTrigger`（L822）之后。使用 `usePaneNavigation` + `mainView`/`setMainView`：
  ```tsx
  const mainView = useAppStore((s) => s.mainView);
  const setMainView = useAppStore((s) => s.setMainView);
  const { newMetaTask } = usePaneNavigation();
  // 图标：新建任务 SquarePen；数字分身 UsersRound；项目群聊 FolderKanban；定时任务 AutomationTaskIcon
  ```
  布局参考图 2：
  - 顶部一个**主行为按钮**「新建任务」（更突出：主题主色描边或浅底 + `SquarePen` 图标），`onClick={() => newMetaTask()}`。
  - 下面 3 个**导航项**（普通 hover 态，选中时 `bg-surface-card-strong text-text-strong`，与既有 active 语义一致）：
    - 数字分身 `UsersRound` → `setMainView("avatars")`，`aria-current={mainView==="avatars"}`
    - 项目群聊 `FolderKanban` → `setMainView("groups")`
    - 定时任务 `AutomationTaskIcon` → `setMainView("automation")`
  - 元智能体品牌行点击仍走 `usePaneNavigation().openMetaOrAvatarPane(null, META_AGENT_DISPLAY_NAME)`（切回聊天并聚焦元窗格）。
- 视觉：沿用现有 token（`text-text-muted` / `hover:bg-surface-card` / `bg-surface-card-strong`），暗色极客风，图标 `h-[18px] w-[18px]`，行高约 `py-2 px-4 gap-2.5`，字号 `text-[15px]`。
- **AC-A4**：侧栏只剩品牌行 + 搜索 + 4 按钮；点导航项主区随之切换且按钮高亮跟随 `mainView`；控制台无「未使用变量/未定义」报错（清理干净残留 state）。

### FR-A5 · App 主区视图路由
文件：`desktop/src/App.tsx`（L2352–2367）

- 引入 `mainView` 与新视图组件，把 `agx-main-content` 内 Pro 分支改为：
  ```tsx
  {userMode === "lite" ? (
    <LiteChatView .../>
  ) : mainView === "avatars" ? (
    <AvatarGalleryView />
  ) : mainView === "groups" ? (
    <ProjectsView />
  ) : mainView === "automation" ? (
    <AutomationView />
  ) : (
    <PaneManager onOpenConfirm={...} onOpenClarification={...} onSubmitClarification={...} />
  )}
  ```
  `const mainView = useAppStore((s) => s.mainView);`（放在 App 内已有 store 订阅区）。
- **注意**：`PaneManager` 承载对话与流式 SSE，切到其它视图时 `PaneManager` 会卸载。为避免中断正在进行的对话流，**主区视图切换只卸载 UI，不应主动 abort SSE**；`PaneManager`/`ChatPane` 卸载已有自身清理逻辑，本次不改其行为——但需在手测中确认「对话进行中点『数字分身』再点回『新建任务』/元窗格」不崩溃（若发现流被中断属既有行为，记录但不在本子规划扩范围修复）。
- **AC-A5**：`mainView` 切换正确渲染四种主区；默认启动为聊天（元智能体），与改造前首屏一致。

### FR-A6 · B/C/D 空壳视图组件
新建三个占位组件，供 A 编译通过、B/C/D 后续填充：
- `desktop/src/components/gallery/AvatarGalleryView.tsx` → 导出 `AvatarGalleryView`，暂渲染标题「数字分身」+ 占位文案。
- `desktop/src/components/groups/ProjectsView.tsx` → 导出 `ProjectsView`，占位「项目群聊」。
- `desktop/src/components/automation/AutomationView.tsx` → 导出 `AutomationView`，占位「定时任务」。
- 三者用统一外层容器（可加轻量 `MainViewShell`：可滚动、`px-6 py-5`、暗色背景），供 B/C/D 复用视觉基线。
- **AC-A6**：三视图能被路由渲染且不报错。

---

## 验收（本子规划）
- **AC-A-BUILD**：`cd desktop && npm run build` 通过（typecheck + vite build）。`ReadLints` 对改动文件无新增错误。
- **AC-A-SMOKE**：`AGX_DEV_PORT=5713 npm run dev` 冷启动无控制台报错；侧栏 4 按钮切换主区（占位视图）正常；点元品牌行/新建任务回到聊天；点分身墙占位再回聊天无崩溃。
- **AC-A-NOREG**：多窗格、历史会话切换、发送消息、流式输出正常（`panes`/`PaneManager` 结构未变）。

## 实施顺序建议
1. store `mainView`（FR-A1）→ 2. hook 抽取（FR-A2/A3）→ 3. 三个空壳视图（FR-A6）→ 4. App 路由（FR-A5）→ 5. 侧栏按钮化并清理残留（FR-A4）→ 6. ChatPane 事件监听（FR-A3 后半）→ 7. build + smoke。
