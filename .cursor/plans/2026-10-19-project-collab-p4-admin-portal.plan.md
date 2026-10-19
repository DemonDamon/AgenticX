# 项目协作 P4：管理后台「项目」页、门户只读视图与审计

Planned-with: Opus 5.5
Suggested-Impl-Model: Grok 4.7
Acceptance-Model: Opus 5.5
Parent: `.cursor/plans/2026-10-19-project-collaboration-space.plan.md`
Depends-on: P0（`enterprise_projects` 表、群的 `project_id / parent_room_id / room_kind`、审计事件）

## 目标

企业管理员能在后台看到所有项目：成员、群的层级、消息量、最近活动；能按权限打开某个群查看对话。员工能在网页门户看到自己参与的项目与群（只读）。

## 现状（已核实）

- 后台分区注册：`enterprise/apps/admin-console/src/lib/admin-platform-sections.ts`（`PLATFORM_SECTION_IDS`，`"cases"` 在 L11；`isPlatformSection()` L17）；动态路由 `src/app/admin/[section]/page.tsx`（`PLATFORM_SECTION_PAGES` L14–25，`cases: CasesSection` L23）；导航 `src/components/AppShell.tsx`（`{ href: "/admin/cases", labelKey: "cases", icon: Library }` L128，在平台分组 L119–129，标签取 `nav.items.<labelKey>`）。
- 页面范式：`src/app/admin/_sections/cases.tsx`（`"use client"`、`adminFetch`、`@agenticx/ui` 的 `PageHeader / Badge / Button`、`useTranslations("pages.admin.cases")`）。
- 文案：`enterprise/apps/admin-console/messages/{zh,en}.json`（`nav.items.cases` L61，`pages.admin.cases` L359）。
- 鉴权：`src/lib/admin-auth.ts`，`requireAdminScope(required[])`（L32，全部满足）、`requireAdminSomeScope(candidates[])`（L51，任一满足），返回 `{ok, session:{email,userId,tenantId}, scopes}`；失败 401 `40101` / 403 `40300`。会话对话类接口用 `["audit:read:all","audit:read:dept","audit:manage"]`。
- 部门可见范式：`enterprise/features/audit/src/services/pg-store.ts` 的 `visibilityPredicates(actor)`（L11–20：`*` / `audit:manage` / `audit:read:all` 看全部；`audit:read:dept` 按部门；否则只看自己）。
- 只读库访问范式：`enterprise/packages/iam-core/src/repos/cases.ts`（Drizzle，`useMysql()` 选方言，PG 用 `getIamDb()`，MySQL 用 `createMysqlDb(config).raw`），在 `iam-core/src/index.ts` L17 导出。
- 门户页面范式：`enterprise/apps/web-portal/src/app/rooms/page.tsx`（服务端组件，`getWorkspaceSessionFromCookies()`，未登录重定向 `/auth`，需改密重定向 `/auth/change-password`），列表组件 `src/components/rooms/RoomListView.tsx`；侧栏按钮在 `src/components/WorkspaceShell.tsx` L413–422（`router.push("/rooms")`，折叠时 `size="icon"`）。

## 改动

### 1. 只读仓储（`enterprise/packages/iam-core/src/repos/projects.ts`，新文件）

```ts
export type AdminProjectRow = {
  id: string; name: string; owner_user_id: string; owner_name: string;
  dept_id: string | null; dept_name: string | null;
  member_count: number; room_count: number; message_count: number;
  last_activity_at: string | null; created_at: string; archived_at: string | null;
};
export type AdminProjectRoom = {
  id: string; title: string; room_kind: "main" | "sub" | "direct";
  parent_room_id: string | null; member_count: number; message_count: number; last_seq: number;
};
export type ProjectVisibility = { mode: "all" } | { mode: "dept"; deptId: string } | { mode: "self"; userId: string };

export async function listAdminProjects(tenantId: string, vis: ProjectVisibility, filter?: { q?: string; limit?: number; offset?: number }): Promise<{ items: AdminProjectRow[]; total: number }>;
export async function getAdminProject(tenantId: string, projectId: string, vis: ProjectVisibility): Promise<{ project: AdminProjectRow; rooms: AdminProjectRoom[]; members: { member_type: string; member_id: string; display_name: string; room_role: string }[] } | null>;
export async function listAdminProjectMessages(tenantId: string, roomId: string, vis: ProjectVisibility, opts?: { afterSeq?: number; limit?: number }): Promise<{ messages: { seq: number; sender_type: string; sender_name: string; content: string; metadata: unknown; created_at: string }[] }>;
```

- `vis.mode="dept"`：只返回 `enterprise_projects.dept_id = deptId` 的项目。
- `vis.mode="self"`：只返回该用户是任一项目群活跃成员的项目。
- 单聊（`room_kind="direct"`）的消息只有 `vis.mode="all"` 才能读取；其他模式在 `getAdminProject` 里仍列出该群（显示「单聊」与条数），但 `listAdminProjectMessages` 返回 403 语义（抛 `ProjectForbiddenError`）。
- `iam-core/src/index.ts` 追加 `export * from "./repos/projects"`。
- PG / MySQL 两套实现，写法与 `cases.ts` 一致。

### 2. 后台接口（`enterprise/apps/admin-console/src/app/api/admin/projects/`）

| 文件 | 方法 | 权限 | 返回 |
|---|---|---|---|
| `route.ts` | GET `?q=&page=&page_size=` | `requireAdminSomeScope(["audit:read:all","audit:read:dept","audit:manage"])` | `{items, total}` |
| `[id]/route.ts` | GET | 同上 | `{project, rooms, members}` |
| `[id]/rooms/[roomId]/messages/route.ts` | GET `?after_seq=&limit=` | 同上 | `{messages}`；单聊且非全量权限返回 403 |

可见范围由 scopes 推导：含 `*`、`audit:manage`、`audit:read:all` → `all`；含 `audit:read:dept` → `dept`（部门取当前管理员用户的 `dept_id`，用 `getAdminUser(tenantId, session.userId)` 读取）；否则 `self`。成功体 `{code:"00000", message:"ok", data}`。读取群消息时调用 `insertAuditEvent({eventType:"project.room.view", targetKind:"collab_room", targetId: roomId})`。

### 3. 后台页面

- `admin-platform-sections.ts`：`PLATFORM_SECTION_IDS` 在 `"cases"` 前加 `"projects"`。
- `[section]/page.tsx`：`PLATFORM_SECTION_PAGES` 加 `projects: ProjectsSection`。
- `AppShell.tsx`：平台分组在案例库前加 `{ href: "/admin/projects", labelKey: "projects", icon: Waypoints }`。
- 新文件 `src/app/admin/_sections/projects.tsx`：
  - 列表：表头「项目」+ 说明「查看员工项目的成员、群与对话记录」；搜索框；表格列：项目名、所有者、部门、成员数、群数、消息数、最近活动；点击行进入详情。
  - 详情（同页内切换，带「返回」）：顶部项目信息；左侧群树（主群、小群缩进、单聊分组，每项显示条数）；右侧选中群的消息列表（只读，按 `seq` 升序，滚动到底时按 `after_seq` 加载更多）；`metadata.kind==="merge_back"` 的消息显示为「合回自「…」」卡片；单聊无权限时右侧显示「无权查看单聊内容」。
- 文案加到 `messages/{zh,en}.json`：`nav.items.projects`（项目 / Projects）与 `pages.admin.projects.*`。不在界面上出现任何表名、文件路径或存储说明。

### 4. 门户只读视图（`enterprise/apps/web-portal`）

- 新页面 `src/app/projects/page.tsx`（写法照抄 `rooms/page.tsx` 的鉴权与重定向）→ 客户端组件 `src/components/projects/ProjectListView.tsx`：调用门户已有会话下的新接口 `GET /api/projects`（新文件 `src/app/api/projects/route.ts`，用门户会话鉴权，内部复用 P0 存储层 `listProjects`）列出「我的项目」卡片。
- `src/app/projects/[projectId]/page.tsx` → `ProjectDetailView.tsx`：群树 + 选中群的消息只读列表（调用 `GET /api/projects/[projectId]` 与已有的房间消息读取方式；单聊只对两位当事人可见）。页面顶部一行提示「在桌面端可以发消息、拉小群和合回」。
- `WorkspaceShell.tsx`：在「协作房间」按钮旁加「我的项目」按钮（`Waypoints` 图标，折叠时 `size="icon"` 不叠 `w-full justify-start`），`router.push("/projects")`。

## In scope / Out of scope

- In：只读仓储、后台三个接口与页面、门户两个页面与接口、侧栏入口、查看审计。
- Out：后台编辑 / 删除 / 归档项目；门户里发消息；从项目一键发布到案例库（继续沿用桌面端画布「回流到企业」）；导出。
- no-scope-creep：不改案例库、审计页现有逻辑；不改 `room_kind="room"` 的旧协作房间页面。

## 验收

- AC-1：`enterprise/packages/iam-core` 新增 `repos/__tests__/projects.test.ts`（按仓库现有仓储测试方式）：`dept` 模式只返回本部门项目；`self` 模式只返回参与的项目；非全量权限读单聊消息抛错。
- AC-2：`admin-console` 新路由测试（`app/api/admin/projects/__tests__/route.test.ts`，写法参照 `api/admin/cases/[id]/transition/__tests__/route.test.ts`）：无权限 403；有 `audit:read:dept` 时调用仓储的可见范围为 `dept`；读消息成功后写一条 `project.room.view` 审计。
- AC-3：`pnpm -C enterprise/packages/iam-core typecheck && pnpm -C enterprise/packages/iam-core test`、`pnpm -C enterprise/apps/admin-console typecheck`、`pnpm -C enterprise/apps/web-portal typecheck && pnpm -C enterprise/apps/web-portal test` 通过。
- AC-4（手工，Opus 验收）：后台左侧点「项目」高亮跟随；列表出现 P2 验收时建的项目；详情群树与桌面端一致；合回消息显示为卡片；用只有 `audit:read:dept` 的管理员打开单聊，提示无权查看。门户「我的项目」能看到同一项目并只读浏览主群。
