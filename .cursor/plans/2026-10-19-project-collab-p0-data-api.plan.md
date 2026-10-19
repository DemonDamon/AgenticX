# 项目协作 P0：项目表、群层级、幂等消息与合回接口

Planned-with: Opus 5.5
Suggested-Impl-Model: Grok 4.7
Acceptance-Model: Opus 5.5
Parent: `.cursor/plans/2026-10-19-project-collaboration-space.plan.md`

## 目标

在现有企业云房间之上加一层「项目」：项目自带主群；群可以有父群（小群）；两名真人之间有单聊；消息支持客户端去重；小群和单聊可以合回父群或主群。只做数据库、存储层和 `web-portal` 的桌面端接口，不碰任何界面。

## 现状（已核实）

- PG 表定义：`enterprise/packages/db-schema/src/schema/collab-rooms.ts`
  - `enterpriseCollabRooms`（L7–27）：`id, tenant_id, title, created_by, archived_at, created_at, updated_at`
  - `enterpriseCollabRoomMembers`（L29–57）：`id, room_id, tenant_id, member_type, member_id, display_name, room_role, joined_at, left_at, …`；唯一索引 `(room_id, member_type, member_id)`
  - `enterpriseCollabRoomMessages`（L59–86）：`id, room_id, tenant_id, seq, sender_type, sender_id, sender_name, content, model, metadata(jsonb), …`；唯一索引 `(room_id, seq)`
- MySQL 镜像：`enterprise/packages/db-schema/src/mysql-schema/collab-rooms.ts`（`datetime(fsp:6)`、`json`、`UTC_TIMESTAMP(6)`）
- 迁移：PG 在 `enterprise/packages/db-schema/drizzle/`，最新 `0056_enterprise_cases.sql`，日志 `drizzle/meta/_journal.json` 末项 `{"idx":55,"version":"7","when":1787400000000,"tag":"0056_enterprise_cases","breakpoints":true}`；MySQL 在 `drizzle-mysql/`，最新 `0030_enterprise_cases.sql`，日志末项 `{"idx":30,"version":"5","when":1787400000001,"tag":"0030_enterprise_cases"}`
- 存储层（在 web-portal，不在 iam-core）：`enterprise/apps/web-portal/src/lib/collab-room/`
  - `types.ts`：`CollabRoomContext {tenantId,userId}`、`CollabMemberType = "human"|"meta"|"agent"`、`CollabSenderType = CollabMemberType|"system"`、`CollabRoomRole = "owner"|"admin"|"member"`、`CollabRoom`、`CollabRoomMessage`、错误类、`interface CollabRoomStore`
  - `index.ts`：按方言分派（穷尽 `never`），导出 `listRooms/createRoom/getRoom/listMembers/addHumanMember/addAgentMember/removeMember/leaveRoom/listMessages/appendMessage/appendAgentMessageAsSystem/resetForTests`
  - `sql-store.ts`：`SqlCollabRoomStore`；`requireActiveMember`（L136）；`createRoom`（L194，事务内建房间 + owner + meta 成员）；`appendMessage`（L471–542，事务内 `max(seq)+1`，唯一冲突重试 3 次，`isUniqueViolation` 在 L97）
- 桌面端接口：`enterprise/apps/web-portal/src/app/api/desktop/rooms/**`；鉴权 `resolveDesktopIdentity(request)`（`lib/desktop-auth.ts` L26）；辅助 `lib/desktop-collab-room-http.ts`（`desktopRoomUnauthorized`、`desktopRoomContext`、`desktopRoomErrorResponse`、`desktopSenderName`）；错误映射 `lib/collab-room-http.ts` L24（403 `40301`、404 `40401`、400 `40001`、500 `50001`）；成功体 `{code:"00000",message:"ok",data}`
- Meta 回复：`lib/collab-room/meta-reply.ts`，`buildMetaPrompt(history, limit=30)` 读全部消息、每条 `clipContent` 截到 4000 字（`CONTENT_LIMIT`）
- 审计：`insertAuditEvent({tenantId, actorUserId, eventType, targetKind, targetId?, detail?})`，`enterprise/packages/iam-core/src/repos/audit.ts` L34

## 改动

### 1. 新表与新列（PG + MySQL 两套，字段完全一致）

新文件 `enterprise/packages/db-schema/src/schema/collab-projects.ts`（MySQL 镜像 `src/mysql-schema/collab-projects.ts`），两个 `index.ts` 追加 `export * from "./collab-projects"`。

`enterprise_projects`：

| 列 | 类型 | 约束 |
|---|---|---|
| `id` | ulid | PK |
| `tenant_id` | ulid | notNull，FK `tenants.id` cascade |
| `name` | varchar(32) | notNull（界面限 15 字，库里留余量） |
| `instructions` | text | 可空 |
| `owner_user_id` | ulid | notNull，FK `users.id` restrict |
| `dept_id` | ulid | 可空（创建者所在部门，用于部门级可见） |
| `main_room_id` | ulid | 可空（建好主群后回填） |
| `settings` | jsonb / json | 可空，存 `{connectors:string[], experts:string[], skills:string[]}` |
| `archived_at` | timestamptz / datetime(6) | 可空 |
| `created_at`, `updated_at` | `auditColumns` | |

索引：`enterprise_projects_tenant_updated_idx (tenant_id, updated_at)`、`enterprise_projects_tenant_dept_idx (tenant_id, dept_id)`。

在 `collab-rooms.ts`（两套）的 `enterpriseCollabRooms` 上新增列：

| 列 | 类型 | 说明 |
|---|---|---|
| `project_id` | ulid，可空，FK `enterprise_projects.id` cascade | 为空即旧的独立房间，行为不变 |
| `parent_room_id` | ulid，可空 | 小群的父群 |
| `room_kind` | varchar(16)，notNull，默认 `'room'` | 取值 `room`（旧房间）/ `main` / `sub` / `direct` |

新增索引 `enterprise_collab_rooms_project_idx (project_id, room_kind)`。

在 `enterpriseCollabRoomMessages`（两套）上新增列 `client_msg_id varchar(64)` 可空，唯一索引 `enterprise_collab_room_messages_room_client_uq (room_id, client_msg_id)`（PG 空值不冲突；MySQL 唯一索引同样允许多个 NULL）。

### 2. 迁移文件

- PG `drizzle/0057_enterprise_projects.sql`：建 `enterprise_projects`、对 `enterprise_collab_rooms` 加 3 列与索引、对消息表加 `client_msg_id` 与唯一索引；语句之间用 `--> statement-breakpoint`；建表用 `CREATE TABLE IF NOT EXISTS`；加列用 `ALTER TABLE … ADD COLUMN IF NOT EXISTS`；文件头写中文注释。
- PG 日志追加 `{"idx":56,"version":"7","when":1787500000000,"tag":"0057_enterprise_projects","breakpoints":true}`。
- MySQL `drizzle-mysql/0031_enterprise_projects.sql`：反引号标识符、具名 `CONSTRAINT …_fk/_uq`、`DEFAULT (UTC_TIMESTAMP(6))`、不写 CHARSET/COLLATE；断点数 = 语句数 − 1。
- MySQL 日志追加 `{"idx":31,"version":"5","when":1787500000001,"tag":"0031_enterprise_projects"}`。
- 同步更新测试：
  - `src/__tests__/migration-inventory.test.ts`：`toHaveLength(56)` 与 `[...Array(56).keys()]` → 57；`slice(-3)` 期望 → `0055…, 0056_enterprise_cases, 0057_enterprise_projects`；SQL 文件数 `toHaveLength(58)` → 59。
  - `src/__tests__/schema-parity.test.ts`：`pgTables.size` 由 67 → 68；MySQL 文件列表与日志 `toEqual` 列表追加 `0031_enterprise_projects`。

### 3. 存储层（`enterprise/apps/web-portal/src/lib/collab-room/`）

`types.ts`：

```ts
export type CollabRoomKind = "room" | "main" | "sub" | "direct";
export type CollabProject = {
  id: string; tenant_id: string; name: string; instructions: string | null;
  owner_user_id: string; dept_id: string | null; main_room_id: string;
  settings: { connectors: string[]; experts: string[]; skills: string[] };
  archived_at: string | null; member_count: number; created_at: string; updated_at: string;
};
```

`CollabRoom` 增加 `project_id: string | null; parent_room_id: string | null; room_kind: CollabRoomKind`。`CollabRoomMessage` 增加 `client_msg_id: string | null`。

`CollabRoomStore` 新增方法（`sql-store.ts` 实现，`index.ts` 导出同名函数）：

| 方法 | 行为 |
|---|---|
| `createProject(ctx, {name, instructions?, settings?, deptId?, displayName, memberUserIds?: {userId, displayName}[]})` | 一个事务：插 `enterprise_projects`；建主群（`room_kind='main'`，title=项目名，owner + meta 成员，与 `createRoom` 相同）；把 `memberUserIds` 作为 human member 加入主群；回填 `main_room_id`；返回 `CollabProject` |
| `listProjects(ctx)` | 当前用户是任一项目群活跃成员的项目，按 `updated_at` 倒序 |
| `getProject(ctx, projectId)` | 非成员抛 `CollabRoomForbiddenError`；返回项目 + 该用户可见的群列表（主群、他所在的小群、他参与的单聊），每个群带 `room_kind, parent_room_id, last_seq` |
| `addProjectMember(ctx, projectId, {userId, displayName, role?})` | 只有 owner/admin 可调；加入主群 |
| `createSubRoom(ctx, parentRoomId, {title, memberUserIds, agentIds?, seedMessageIds?})` | 调用者必须是父群活跃成员；成员必须是父群成员的子集，否则 `CollabRoomBadRequestError`；`room_kind='sub'`、`project_id` 继承父群、`parent_room_id=parentRoomId`；若有 `seedMessageIds`，把这些父群消息拼成一条 `system` 消息写入新群，`metadata={kind:"seed", source_room_id, message_ids}` |
| `openDirectRoom(ctx, projectId, {peerUserId, peerDisplayName})` | 同一项目同一对人只存在一个 `direct` 群（按项目 + 两人成员查找，已存在则返回）；不加 meta 成员；双方都必须是主群成员 |
| `mergeBack(ctx, sourceRoomId, {targetRoomId, mode: "all"\|"selected"\|"summary", messageIds?, summaryText?})` | 见下表 |
| `approveMerge(ctx, sourceRoomId, mergeRequestSeq)` | 单聊合回的另一方确认 |

`mergeBack` 规则：

| 条件 | 行为 |
|---|---|
| 源群与目标群不属于同一项目 | `CollabRoomBadRequestError` |
| 调用者不是源群和目标群的活跃成员 | `CollabRoomForbiddenError` |
| `mode="selected"` 且 `messageIds` 为空 | `CollabRoomBadRequestError` |
| `mode="summary"` 且 `summaryText` 为空 | `CollabRoomBadRequestError`（摘要由客户端生成，服务端不调模型） |
| 源群 `room_kind='sub'` | 直接在目标群追加一条 `system` 消息 |
| 源群 `room_kind='direct'` | 在源群追加一条 `system` 消息，`metadata={kind:"merge_request", target_room_id, mode, message_ids, summary_text, requested_by}`，返回 `{pending:true}`；另一方调 `approveMerge` 后才在目标群追加 |

追加到目标群的消息：

- `sender_type="system"`，`sender_id=<调用者 userId>`，`sender_name=<调用者显示名>`
- `metadata={kind:"merge_back", source_room_id, source_title, mode, message_ids, participants:string[], from_seq, to_seq, count}`
- `content`：`all`/`selected` 时为「【合回自「<源群名>」，共 N 条】\n<发送者>：<内容>」逐行拼接；`summary` 时为「【合回摘要自「<源群名>」】\n<summaryText>」。内容总长上限 12000 字，超出截断并在末尾加「…（完整记录见原群）」。

`appendMessage` 改动：入参新增可选 `clientMsgId?: string`。事务开头若 `clientMsgId` 非空，先按 `(room_id, client_msg_id)` 查已有消息，有则直接返回该消息，不分配新 `seq`。插入时写入 `client_msg_id`。唯一冲突重试逻辑保持不变，但若冲突来自 `client_msg_id` 索引，也改为查回已有消息返回。

### 4. Meta 读取合回内容

`lib/collab-room/meta-reply.ts` 的 `buildMetaPrompt`：对 `item.metadata?.kind === "merge_back"` 的消息使用 12000 字上限，其余仍是 `CONTENT_LIMIT`（4000）。其他逻辑不变。

### 5. 接口（`enterprise/apps/web-portal/src/app/api/desktop/`）

全部用 `resolveDesktopIdentity` 鉴权，未登录返回 `desktopRoomUnauthorized()`，id 用 `isValidUlid` 校验，错误走 `desktopRoomErrorResponse`，成功体 `{code:"00000",message:"ok",data}`。

| 文件 | 方法 | 请求体 | 返回 `data` |
|---|---|---|---|
| `projects/route.ts` | GET | — | `{projects: CollabProject[]}` |
| `projects/route.ts` | POST | `{name, instructions?, settings?, member_user_ids?: {user_id, display_name}[]}`；`name` 去空格后 1–15 字 | `{project}` |
| `projects/[projectId]/route.ts` | GET | — | `{project, rooms}` |
| `projects/[projectId]/members/route.ts` | POST | `{user_id, display_name, role?}` | `{member}` |
| `projects/[projectId]/direct/route.ts` | POST | `{peer_user_id, peer_display_name}` | `{room}` |
| `rooms/[roomId]/sub-rooms/route.ts` | POST | `{title, member_user_ids, agent_ids?, seed_message_ids?}` | `{room}` |
| `rooms/[roomId]/merge/route.ts` | POST | `{target_room_id, mode, message_ids?, summary_text?}` | `{message}` 或 `{pending:true, request_seq}` |
| `rooms/[roomId]/merge/[seq]/approve/route.ts` | POST | — | `{message}` |
| `rooms/[roomId]/messages/route.ts`（已有） | POST | 新增可选 `client_msg_id`（≤64 字） | 不变 |

`GET /api/desktop/rooms`（已有）返回的房间需带上新字段 `project_id, parent_room_id, room_kind`；旧桌面端忽略未知字段即可。

### 6. 审计

以下操作在成功后调用 `insertAuditEvent`（`targetKind="project"` 或 `"collab_room"`）：`project.create`、`project.member.add`、`project.room.sub_create`、`project.room.direct_open`、`project.merge_back`、`project.merge_approve`。

## In scope / Out of scope

- In：上述表、迁移、存储层、接口、审计、单测。
- Out：任何桌面端或后台界面；摘要生成（客户端做）；项目删除与归档接口；访客成员。
- no-scope-creep：不改旧房间（`room_kind='room'`）的任何行为；不改 `events/route.ts` 的事件格式；不改 `triggerMetaReply` 除 §4 外的逻辑。

## 验收

- AC-1（迁移）：`pnpm -C enterprise/packages/db-schema test` 通过，含 `migration-inventory.test.ts` 与 `schema-parity.test.ts`。
- AC-2（存储）：在 `lib/collab-room/sql-store.test.ts` 新增用例：
  - `createProject` 后 `main_room_id` 非空，主群 `room_kind="main"`，owner、meta、受邀成员都在。
  - `createSubRoom` 传入非父群成员时报 BadRequest。
  - `openDirectRoom` 调两次返回同一 `room.id`。
  - `appendMessage` 用同一 `clientMsgId` 调两次，只产生一条消息，`seq` 相同。
  - 小群 `mergeBack` 三种模式各一条，目标群消息 `metadata.kind="merge_back"`，`content` 以「【合回」开头。
  - 单聊 `mergeBack` 返回 `pending`，`approveMerge` 后目标群才出现消息。
- AC-3（接口）：在 `app/api/desktop/projects/__tests__/` 与 `app/api/desktop/rooms/__tests__/` 按现有路由测试写法（`vi.mock("…/lib/desktop-auth")`、`vi.mock("…/lib/collab-room")`、直接调用 `GET/POST`）覆盖：未登录 401、名称超长 400、成功 200 返回体结构。
- AC-4（Meta）：`meta-reply.test.ts` 新增：一条 9000 字的 `merge_back` 消息在 `buildMetaPrompt` 结果里不被截到 4000。
- AC-5：`pnpm -C enterprise/apps/web-portal typecheck` 与 `pnpm -C enterprise/apps/web-portal test` 通过。
