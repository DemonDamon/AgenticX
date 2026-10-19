# 项目协作 P1：桌面端左栏「任务 / 空间」、本地目录空间、项目协作首页与新建项目

Planned-with: Opus 5.5
Suggested-Impl-Model: Grok 4.7
Acceptance-Model: Opus 5.5
Parent: `.cursor/plans/2026-10-19-project-collaboration-space.plan.md`
Depends-on: P0（项目列表与新建接口；未完成时用接口单测里的假数据开发，不阻塞本地空间部分）

## 目标

1. 左栏会话区改成两组：「任务（N）」与「空间（N）」。空间里有本地目录空间和云端项目。
2. 用户可以新建本地目录空间（选一个已有目录），在空间里新建任务；任务自动绑定该目录。
3. 主导航「多人协作」改名为「项目协作」，进入后是项目首页（卡片 + 从模板创建 + 新建项目弹窗）。
4. 主导航移除「专家群聊」入口，本机专家群从项目协作首页进入，功能不变。

## 现状（已核实）

- 导航定义：`desktop/src/components/AvatarSidebar.tsx` L42–60 `NAV_ENTRY_DEFS`（`new-task` action，`avatars / groups / collab / automation / wiki / market` view），`NAV_LABEL_KEY` 同处；点击 view 调 `setMainView(entry.id)`（L287–307）；L310 渲染 `<SidebarSessionHistory />`。
- `MainView`：`desktop/src/store.ts` L185–192 `"chat"|"avatars"|"groups"|"collab"|"automation"|"wiki"|"market"`；`setMainView` L1381；`openCollabRooms()` L3304。
- 视图挂载：`desktop/src/App.tsx` L2698–2703，`"groups"` → `<ProjectsView />`，`"collab"` → `<CollabRoomPanel variant="page" />`。
- 会话列表：`desktop/src/components/sidebar/SidebarSessionHistory.tsx`（`export function SidebarSessionHistory()` L129；`CollapseState {wechat, feishu, pinned, today, earlier}` L72；`loadCollapse()` L88；`loadSessions` L213 调 `window.agenticxDesktop.listSessions()`，5 秒轮询；数据管道 L382–440；表头 L1378–1381 显示 `t("history.title")`；`sectionHeader(key,label,opts)` L1336 支持 `badge`、`trailing`）。工具函数在 `desktop/src/utils/sidebar-session-history.ts`（`SIDEBAR_HISTORY_COLLAPSE_KEY = "agx-sidebar-history-collapse-v1"` L470–472），测试 `sidebar-session-history.test.ts`。
- 新建任务：`desktop/src/hooks/usePaneNavigation.ts` L256 `newMetaTask(draftText?)` → 派发 `agenticx:pane:new-topic {paneId, draftText}`；`ChatPane.tsx` L13526–13551 `onNewTopic` 处理，Meta/分身会话**首次发送时才创建 session**（L13498–13500 注释）。
- 选目录：preload `chooseDirectory`（`desktop/electron/preload.ts` L416，IPC `choose-directory`）；绑定目录 `window.agenticxDesktop.addTaskspace({sessionId, path, label})`（`WorkspaceFolderPicker.tsx` L158–170 `registerTaskspaces` 的写法）。
- 企业接口：主进程 `desktop/electron/collab-room-client.ts`（`normalizePortalBase`、`mapCollabRoomHttpError`、`listRooms` 等，`Bearer` + 15 秒超时）；凭据由 `main.ts` L7993 `resolveCollabRoomDeps()` 读 `loadAgxConfig().enterprise.base_url/token`；IPC 注册在 `main.ts` L8018–8105；登录态 `load-enterprise-account`（L8669）返回 `{loggedIn, email, displayName, portalUrl}`，变化事件 `enterprise-account-changed`。
- 专家群首页：`desktop/src/components/groups/ProjectsView.tsx`（L53），模板 `group-templates.ts`（`GROUP_TEMPLATES`：`product-flow / market-research / team-kb / delivery / bug-track / fullstack-squad`）。
- 文案：`desktop/locales/{zh,en}/sidebar.json` `nav.*`（`groups`=「专家群聊」、`collab`=「多人协作」）、`history.title`（L194）。

## 改动

### 1. 本地目录空间存储（主进程）

新文件 `desktop/electron/local-spaces.ts`，数据文件 `~/.agenticx/spaces.json`：

```ts
export type LocalSpace = { id: string; name: string; path: string; created_at: number };
export type LocalSpacesFile = { version: 1; spaces: LocalSpace[]; session_space: Record<string, string> };
export function readLocalSpaces(): LocalSpacesFile;           // 文件不存在或损坏返回 {version:1, spaces:[], session_space:{}}
export function writeLocalSpaces(data: LocalSpacesFile): void; // 先写 .tmp 再 rename
```

`main.ts` 注册 IPC（与其他 `ipcMain.handle` 同区）：

| IPC | 入参 | 返回 |
|---|---|---|
| `local-spaces-list` | — | `LocalSpacesFile` |
| `local-spaces-create` | `{path, name?}` | `{ok:true, space}`；`path` 不存在或不是目录返回 `{ok:false, error:"not-a-directory"}`；同一 `path` 已存在则返回已有空间；`name` 默认目录名 |
| `local-spaces-remove` | `{id}` | `{ok:true}`；同时删除 `session_space` 里指向它的映射（只是移除归类，不删会话、不删目录） |
| `local-spaces-assign` | `{sessionId, spaceId}` | `{ok:true}` |

`preload.ts` 暴露 `localSpacesList / localSpacesCreate / localSpacesRemove / localSpacesAssign`，`desktop/src/global.d.ts` 补类型。

### 2. 项目接口客户端（主进程）

在 `desktop/electron/collab-room-client.ts` 增加（与现有函数同风格，同样的超时与错误映射）：

```ts
export async function listProjects(deps): Promise<{ projects: CollabProjectSummary[] }>;   // GET /api/desktop/projects
export async function createProject(deps, input: { name: string; instructions?: string;
  settings?: { connectors: string[]; experts: string[]; skills: string[] };
  member_user_ids?: { user_id: string; display_name: string }[] }): Promise<{ project: CollabProjectSummary }>; // POST
```

`CollabProjectSummary = { id, name, instructions, main_room_id, member_count, created_at, updated_at }`。`main.ts` 注册 `collab-project-list`、`collab-project-create`（用 `resolveCollabRoomDeps()`，未登录返回 `{ok:false, error:"enterprise-login-required"}`）；preload 暴露 `collabProjectList / collabProjectCreate`。

### 3. 左栏信息架构

`SidebarSessionHistory.tsx`：

- 表头文案由 `history.title` 改为 `history.tasks`（「任务」），右侧 `badge` 显示任务数 N。N = 当前过滤后、**不属于任何本地空间**的会话数。
- 加载会话后，用 `localSpacesList()` 的 `session_space` 把会话分成两部分：属于某空间的会话从「置顶 / 今天 / 更早」中剔除，交给空间区展示；其余照旧。
- `CollapseState` 新增 `tasks` 与 `spaces` 两个键，`loadCollapse()` 对旧数据缺省为 `false`（展开）。
- 在任务分组之后渲染新组件 `<SidebarSpaces />`（新文件 `desktop/src/components/sidebar/SidebarSpaces.tsx`），传入 `{rowsBySpace, onOpenSession}`。

`SidebarSpaces.tsx`：

| 区域 | 内容 |
|---|---|
| 组表头 | 「空间（N）」，N = 本地空间数 + 项目数；右侧两个图标按钮：`Shrink`（全部收起，HoverTip「全部收起」）、`FolderPlus`（新建空间，HoverTip「新建空间」） |
| 本地空间行 | `FolderOpen` 图标 + 名称；点击展开 / 收起；展开后列出该空间的会话（标题 + 日期，样式与任务列表行一致）；行末悬停出现 `Plus`（「在此空间新建任务」）；右键自定义菜单「在访达中显示」「移除空间」（文案用「移除」，不删目录） |
| 项目行 | 仅在企业已登录时出现；`Waypoints` 图标 + 项目名；点击调用 `openProject(projectId)`（见 §5） |
| 空态 | 无空间时只显示组表头与「新建空间」按钮 |

展开状态存 localStorage `agx-sidebar-spaces-expanded-v1`（`Record<spaceId, boolean>`）。

「新建空间」：调用 `chooseDirectory()`；取消则什么都不做；成功后 `localSpacesCreate({path})`，刷新列表并展开新空间。

### 4. 在空间里新建任务

- `usePaneNavigation.newMetaTask(draftText?, opts?: { spaceId?: string })`：把 `spaceId` 一并放进 `agenticx:pane:new-topic` 的 `detail`。
- `ChatPane.tsx` 的 `onNewTopic`（L13526 起）：若 `detail.spaceId` 存在，把它记到新 ref `pendingSpaceIdRef`。
- 在 Meta 窗格**首次创建 session** 的地方（`ChatPane.tsx` 内 `sendChat` 路径里调用 `window.agenticxDesktop.createSession` 之后、拿到新 `session_id` 的位置；用 `grep -n "createSession(" desktop/src/components/ChatPane.tsx` 定位首发创建分支），若 `pendingSpaceIdRef.current` 非空：
  1. 读空间路径（`localSpacesList()` 找 id）；
  2. `addTaskspace({sessionId, path, label: space.name})`；
  3. `localSpacesAssign({sessionId, spaceId})`；
  4. 清空 `pendingSpaceIdRef`，并派发 `agenticx:spaces:changed` 让左栏刷新。
- 失败只记 `console.warn`，不阻断发送。

### 5. 主导航与项目协作首页

- `AvatarSidebar.tsx`：从 `NAV_ENTRY_DEFS` 删除 `groups` 项；`collab` 图标改为 `Waypoints`；`NAV_LABEL_KEY.collab` 不变，改 `sidebar.json` 文案。`MainView` 联合类型**不删** `"groups"`，专家群首页仍可从项目协作首页进入。
- `store.ts` 新增 `activeProjectId: string | null` 与 `openProject(projectId: string | null)`（设置 `activeProjectId` 并 `setMainView("collab")`）。
- `App.tsx` L2698–2703：`"collab"` 改为渲染新组件 `<ProjectCollabView />`（新文件 `desktop/src/components/projects/ProjectCollabView.tsx`）。`activeProjectId` 为空时渲染首页；不为空时渲染 P2 的项目详情（本期先渲染 `<CollabRoomPanel variant="page" />` 作为占位，P2 替换）。

`ProjectCollabView` 首页：

| 区域 | 内容 |
|---|---|
| 标题区 | 「项目」+ 副标题「多人协作，打造超级团队」+ 主按钮「新建项目」（`--ui-btn-primary-*` 变量） |
| 未登录 | 卡片提示「登录企业账号后可创建和加入项目」+ 按钮跳设置的账号页（复用现有跳转方式，`AccountTab`） |
| 我的项目 | `collabProjectList()` 结果的卡片网格（图标、名称、「添加于 X 前」、更多菜单占位）；右上搜索框按名称过滤；点卡片 `openProject(id)` |
| 本机专家群 | 一行入口卡片「本机专家群」+ 说明「只在本机运行的数字专家群聊」，点击 `setMainView("groups")` |
| 从模板创建 | 复用 `GROUP_TEMPLATES` 的标题与说明；点击打开新建项目弹窗并把模板的说明文字填入「指令」 |

### 6. 新建项目弹窗

新文件 `desktop/src/components/projects/NewProjectDialog.tsx`（主题化弹层，不透明背景，与 `SettingsPanel` 同语义）：

| 字段 | 规则 |
|---|---|
| 项目名称 | 必填，`maxLength=15`，右下 `n/15` 计数 |
| 指令 | 可选多行；右上「选择模板」下拉（`GROUP_TEMPLATES`）；切换模板覆盖当前内容，底部左侧提示「切换模板会覆盖当前编辑内容」 |
| 连接器 | 可选；「+ 添加」打开已连接 MCP 列表多选（数据来源与设置页 MCP 列表一致） |
| 专家 | 可选；「+ 添加」打开分身列表多选（`useAppStore` 的 avatars） |
| 技能 | 可选；「+ 添加」打开技能列表多选（与设置页技能列表同源） |
| 底部 | 「取消」紧靠「确定」左侧；名称为空时「确定」置灰；提交中按钮显示进行中；失败保留弹窗并在弹窗内显示接口返回的错误文案 |

成功后关闭弹窗、刷新首页列表、`openProject(newId)`，并派发 `agenticx:spaces:changed`。

### 7. 文案（`desktop/locales/{zh,en}/sidebar.json` 及新增 `projects.json` 命名空间）

| key | zh | en |
|---|---|---|
| `nav.collab` | 项目协作 | Projects |
| `history.tasks` | 任务 | Tasks |
| `spaces.title` | 空间 | Spaces |
| `spaces.collapseAll` | 全部收起 | Collapse all |
| `spaces.create` | 新建空间 | New space |
| `spaces.newTaskHere` | 在此空间新建任务 | New task in this space |
| `spaces.remove` | 移除空间 | Remove space |
| `spaces.reveal` | 在访达中显示 | Show in Finder |
| `projects.title` | 项目 | Projects |
| `projects.subtitle` | 多人协作，打造超级团队 | Work together as one team |
| `projects.new` | 新建项目 | New project |
| `projects.mine` | 我的项目 | My projects |
| `projects.fromTemplate` | 从模板创建 | Start from a template |
| `projects.localGroups` | 本机专家群 | Local expert groups |
| `projects.localGroupsHint` | 只在本机运行的数字专家群聊 | Expert group chats that run on this computer |
| `projects.needLogin` | 登录企业账号后可创建和加入项目 | Sign in to your organization to create and join projects |
| `projects.dialog.name` / `instructions` / `connectors` / `experts` / `skills` / `optional` / `add` / `pickTemplate` / `templateOverwrite` / `cancel` / `confirm` | 项目名称 / 指令 / 连接器 / 专家 / 技能 / （可选）/ 添加 / 选择模板 / 切换模板会覆盖当前编辑内容 / 取消 / 确定 | Name / Instructions / Connectors / Experts / Skills / (optional) / Add / Template / Switching templates replaces what you typed / Cancel / Create |

`desktop/src/i18n` 注册 `projects` 命名空间（参照现有命名空间注册方式）。

## In scope / Out of scope

- In：上述存储、IPC、左栏两组、空间内新建任务、导航调整、项目首页、新建弹窗、文案、单测。
- Out：项目详情、群树、单聊、合回（P2）；离线缓存（P3）；成员邀请（P2 在详情里做，本期弹窗不含成员）；本地空间的重命名与排序。
- no-scope-creep：不改会话持久化格式与 `/api/sessions`；不改 `ProjectsView` 与 `GroupEditorInline` 的内部逻辑；`CollabRoomPanel` 只作为占位挂载，不改它。

## 验收

- AC-1：`desktop/electron/local-spaces.test.ts`（或 `desktop/tests/local-spaces.test.ts`）：文件不存在返回空结构；同一路径创建两次只有一个空间；`remove` 清掉 `session_space` 里的映射。
- AC-2：`desktop/src/utils/sidebar-session-history.test.ts` 新增：给定 `session_space`，属于空间的会话不出现在 today/earlier，任务计数正确。为分组逻辑抽一个纯函数 `splitRowsBySpace(rows, sessionSpace)` 放在同文件并单测。
- AC-3：`desktop/src/components/sidebar/SidebarSpaces.test.tsx`（`renderToStaticMarkup` + store mock，写法参照 `SidebarAccountBar.test.tsx`）：渲染「空间（3）」、两个本地空间与一个项目；未登录时不渲染项目行。
- AC-4：`desktop/src/components/projects/NewProjectDialog.test.tsx`：名称为空时确定按钮 `disabled`；输入 16 字被截到 15；切换模板后指令内容被替换。
- AC-5：`AvatarSidebar` 渲染结果不含「专家群聊」，含「项目协作」。
- AC-6：`cd desktop && npx tsc --noEmit -p tsconfig.json`、`npx tsc -p electron/tsconfig.json`、`npm test` 全部通过。
- AC-7（手工，Opus 验收时执行）：新建本地空间 → 在空间里新建任务并发送一条消息 → 该任务出现在空间下、不出现在「任务」分组，且右侧工作区已挂载该目录。
