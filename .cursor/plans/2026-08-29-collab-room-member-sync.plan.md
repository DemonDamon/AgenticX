# 协作房间 · 按邮箱加人 + 桌面成员快照刷新

Planned-with: grok 4.6
Suggested-Impl-Model: grok 4.6

**父规划：** `.cursor/plans/2026-08-28-collab-room-master.plan.md`（C1 加人）+ `.cursor/plans/2026-08-29-collab-room-c3-03-desktop-ui.plan.md`（桌面只读成员）

**Goal:** 本地/门户注册用户能用登录邮箱被拉进房间；桌面端已打开的房间能在数秒内看到成员增减，不必关面板重进。

---

## 根因与证据链

1. 门户注册走 `enterprise/apps/web-portal/src/lib/auth-runtime.ts` 的 `buildUserId()`，把 `alice2@agenticx.local` 收成 `user_alice2_agenticx_local`。后台「用户管理」详情里展示的就是这串，**不是** ULID。
2. C1 `POST /api/rooms/:roomId/members`（`enterprise/apps/web-portal/src/app/api/rooms/[roomId]/members/route.ts`）在查库前执行 `isValidUlid(targetId)`。slug 与「长得像 ULID 但不是该用户」的串（如 `01J00000000000000000000000`）都会 400，UI 只显示「添加失败，请检查用户 ID 后重试」。
3. `SqlCollabRoomStore.addHumanMember`（`enterprise/apps/web-portal/src/lib/collab-room/sql-store.ts`）原先只 `select … from users where id = ?`。即使去掉 ULID 门闩，按邮箱也查不到人。
4. 桌面 `CollabRoomPanel.openRoom` 只在点进房间时调一次 `collabRoomGet`。SSE（`enterprise/apps/web-portal/src/lib/collab-room/events.ts`）只有 `room_message` / `room_cursor` / `room_ping` / `room_closed`，**没有**成员变更事件。门户加人后桌面顶栏仍停在进房快照。

本 plan **不新增 SSE 事件类型**（避免改 C1 协议与桌面主进程事件映射）。桌面用已有 `collabRoomGet` 做成员快照轮询。

---

## In scope / Out of scope

**In scope**

- Cookie 侧 `POST /api/rooms/:roomId/members` 接受登录邮箱或真实 `users.id`（ULID 或 slug）
- store 按租户解析 `id` **或** `lower(email)`，成员行写入解析后的 `users.id`
- 门户成员栏 placeholder / 失败文案改为引导填邮箱
- 桌面打开中的房间每 3s 拉一次 `collabRoomGet`，成员集合变化才 `setMembers`

**Out of scope**

- 不改 `/api/desktop/rooms/**` 的鉴权或消息协议
- 不新增 `room_members` SSE 事件
- 桌面端不做建房 / 加人 / 移出（仍只读）
- 不改 Meta 回复的 PAT/Cookie token 缺口（另一条线）

---

## 落点

| 文件 | 改动 |
|---|---|
| `enterprise/apps/web-portal/src/lib/collab-room/sql-store.ts` · `addHumanMember` | 见下方 SQL |
| `enterprise/apps/web-portal/src/lib/collab-room/sql-store.test.ts` | 邮箱解析到真实 id；未知邮箱仍 BadRequest |
| `enterprise/apps/web-portal/src/app/api/rooms/[roomId]/members/route.ts` | 去掉 `user_id` 的 `isValidUlid`；空串仍 400 |
| `enterprise/apps/web-portal/src/app/api/rooms/[roomId]/members/route.test.ts` | 新建：邮箱可 POST；空 `user_id` 400 |
| `enterprise/apps/web-portal/src/components/rooms/RoomMembersPanel.tsx` | placeholder「输入对方登录邮箱」；失败文案指向邮箱 |
| `desktop/src/utils/collab-room-view.ts` | 新增 `memberKey` / `membersChanged` |
| `desktop/src/utils/collab-room-view.test.ts` | 新增成员集合变化用例 |
| `desktop/src/components/CollabRoomPanel.tsx` | `MEMBER_POLL_MS = 3000`；`refreshSnapshot` + `live`/`retrying` 时 interval |

---

## FR / AC

- **FR-1**：`addHumanMember` 在当前租户内用 `id = target OR lower(email) = lower(target)` 解析用户；插入/恢复成员行时用解析后的 `id`。显示名：body 未另给且等于查找串时，回落库内 `display_name` → `email` → id。
- **AC-1**：`pnpm -C enterprise/apps/web-portal exec vitest run src/lib/collab-room/sql-store.test.ts src/app/api/rooms/[roomId]/members/route.test.ts` 绿。断言含：`userId: "alice2@agenticx.local"` 时 `member_id` 为库内真实 id，不是邮箱本身。
- **FR-2**：`POST /api/rooms/:id/members` 的 `user_id` 只要非空即可，不再要求 ULID。
- **AC-2**：路由单测「accepts a login email that is not a ULID」返回 200，并按原样把邮箱传给 store。
- **FR-3**：桌面房间 `status` 为 `live` 或 `retrying` 时立即拉一次快照，之后每 3s 再拉；`activeRoomIdRef` 已切走则丢弃结果；`membersChanged` 为 false 时不重设 members。
- **AC-3**：`npx vitest run src/utils/collab-room-view.test.ts`（在 `desktop/`）含「newly added member」为 true。手测：门户把 `alice2@agenticx.local` 加进已打开的房间后，桌面顶栏 ≤3s 出现该成员。

---

## `addHumanMember` 查找 SQL（意图）

```sql
select id, tenant_id, email, display_name from users
 where tenant_id = ?
   and is_deleted = false
   and deleted_at is null
   and (id = ? or lower(email) = lower(?))
 limit 1
```

占位符按现有 `this.p`（PG `$n` / MySQL `?`）。查不到或 `tenant_id` 不匹配 → 仍抛 `CollabRoomBadRequestError("member is not in this tenant")`。后续 existing / insert / 恢复 `left_at` 一律用 `resolvedId`，禁止把邮箱写进 `member_id`。

---

## 桌面 `refreshSnapshot`（意图）

1. `collabRoomGet(roomId)`
2. 若 `activeRoomIdRef.current !== roomId` return
3. `ok: false` 且 error 为「你已被移出该房间」→ `setStatus("revoked")`
4. 解析 `room` / `members` / `viewer_user_id`；`setMembers(prev => membersChanged(prev, next) ? next : prev)`
5. 用 `room.member_count ?? members.length` 更新左侧列表该项的 `member_count`

禁止在轮询里重拉历史消息或重启 `collabRoomWatch`。
