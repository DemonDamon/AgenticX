# C3-01 · portal 新增 PAT 鉴权的房间接口 `/api/desktop/rooms/*`

Planned-with: claude-opus-5
Suggested-Impl-Model: 代码专精中档（如 Codex 系列）

**父规划：** `.cursor/plans/pending/2026-08-29-collab-room-c3-master.plan.md`

**Goal:** 给 Near 桌面端一套用企业 PAT 鉴权的房间接口，读写的是 C1 那张表、那一份 store。桌面端与浏览器的差别只在「怎么证明你是谁」，不在「房间数据在哪」。

---

## 一、为什么新开路由而不是改 C1 的路由

C1 的 `/api/rooms/**` 每个 handler 第一行都是 `getSessionFromCookies()`（例如 `enterprise/apps/web-portal/src/app/api/rooms/route.ts:12`）。若在同一个 handler 里再塞一条 Bearer 分支，会出现「同一入口两套身份来源」，鉴权面变宽且难回归。

portal 已有 `/api/desktop/*` 这个 PAT 命名空间（`bootstrap`、`capabilities`、`auth/*`），本子 plan 顺着它加 `rooms`，与既有约定一致。

**硬约束：本子 plan 一行都不改 `enterprise/apps/web-portal/src/app/api/rooms/**`，也不改 `enterprise/apps/web-portal/src/lib/collab-room/**`。**

---

## 二、可直接信任的现状（不必重新摸查）

| 件 | 精确位置 | 签名 / 形状 |
|---|---|---|
| PAT → 身份 | `enterprise/apps/web-portal/src/lib/desktop-auth.ts:26` | `resolveDesktopIdentity(request: Request): Promise<DesktopIdentity \| null>`；`DesktopIdentity = { userId, tenantId, deptId, email, displayName, tokenId, scopes }` |
| 房间 store 门面 | `enterprise/apps/web-portal/src/lib/collab-room/index.ts` | `listRooms(ctx)` L44、`getRoom(ctx, roomId)` L55、`listMembers(ctx, roomId)` L59、`listMessages(ctx, roomId, { afterSeq?, limit? })` L79、`appendMessage(ctx, roomId, input)` L87 |
| 房间上下文类型 | `enterprise/apps/web-portal/src/lib/collab-room/types.ts:1` | `CollabRoomContext = { tenantId: string; userId: string }` |
| 领域错误 | 同上 L48–67 | `CollabRoomNotFoundError` / `CollabRoomForbiddenError` / `CollabRoomBadRequestError` |
| Cookie 侧错误映射 | `enterprise/apps/web-portal/src/lib/collab-room-http.ts:24` | `collabRoomErrorResponse(error)`（复用 chat-history 的 40301/40401/40001/50001） |
| SSE 事件协议 | `enterprise/apps/web-portal/src/lib/collab-room/events.ts` | `formatCollabRoomEventSse(event)`；`room_cursor` / `room_message` / `room_ping` / `room_closed`（`reason: "timeout" \| "gone"`） |
| Cookie 侧 SSE 实现（照抄轮询与收流骨架） | `enterprise/apps/web-portal/src/app/api/rooms/[roomId]/events/route.ts` | `POLL_MS`、`PING_EVERY_MS`、`safeEnqueue`、abort listener、`cancel()`、只对 Forbidden/NotFound 播 `gone` |
| Meta 触发 | `enterprise/apps/web-portal/src/lib/collab-room/meta-reply.ts` | `mentionsMeta(content)`、`triggerMetaReply(ctx, roomId, session, overrides?)`；`session` 形参类型是 `AuthContext` |
| Cookie 侧 POST messages 的 Meta 接线（照抄语义） | `enterprise/apps/web-portal/src/app/api/rooms/[roomId]/messages/route.ts:81-89` | `appendMessage` 成功后 `await triggerMetaReply(...).catch(log)`，POST 仍返回 200 |
| PAT 路由的 401 形状 | `enterprise/apps/web-portal/src/app/api/desktop/bootstrap/route.ts:16-21` | `NextResponse.json({ code: "40101", message: "企业登录已失效，请重新登录" }, { status: 401 })` |
| ULID 校验 | `enterprise/apps/web-portal/src/lib/chat-history` 导出 `isValidUlid` | C1 各路由已在用 |

`triggerMetaReply` 的 `session: AuthContext` 需要 `userId` / `tenantId` / `email` / `deptId` / `sessionId` / `scopes`。`DesktopIdentity` 缺 `sessionId` 与 `scopes` 的语义对齐，需要在本子 plan 里显式构造（见 FR-01-5）。

---

## 三、落点清单（新增 5 个文件 + 2 个测试文件，不改既有文件）

```
enterprise/apps/web-portal/src/lib/desktop-collab-room-http.ts              (新增)
enterprise/apps/web-portal/src/lib/desktop-collab-room-http.test.ts         (新增)
enterprise/apps/web-portal/src/app/api/desktop/rooms/route.ts               (新增, GET)
enterprise/apps/web-portal/src/app/api/desktop/rooms/[roomId]/route.ts      (新增, GET)
enterprise/apps/web-portal/src/app/api/desktop/rooms/[roomId]/members/route.ts   (新增, GET)
enterprise/apps/web-portal/src/app/api/desktop/rooms/[roomId]/messages/route.ts  (新增, GET + POST)
enterprise/apps/web-portal/src/app/api/desktop/rooms/[roomId]/events/route.ts    (新增, GET SSE)
enterprise/apps/web-portal/src/app/api/desktop/rooms/__tests__/route.test.ts     (新增)
enterprise/apps/web-portal/src/app/api/desktop/rooms/__tests__/messages.test.ts  (新增)
enterprise/apps/web-portal/src/app/api/desktop/rooms/__tests__/events.test.ts    (新增)
```

---

## 四、FR

- **FR-01-1**：新增 `enterprise/apps/web-portal/src/lib/desktop-collab-room-http.ts`，导出：
  - `desktopRoomUnauthorized()` → `{ code: "40101", message: "企业登录已失效，请重新登录" }`，401
  - `desktopRoomContext(identity: DesktopIdentity): CollabRoomContext` → `{ tenantId: identity.tenantId, userId: identity.userId }`
  - `desktopRoomErrorResponse(error: unknown)` → 直接转调 `collabRoomErrorResponse`（`./collab-room-http`），保持与 Cookie 侧同一套错误码
  - `desktopSenderName(identity: DesktopIdentity): string` → `identity.displayName?.trim() || identity.email?.trim() || identity.userId`
  - `desktopAuthContext(identity: DesktopIdentity): AuthContext` → 见 FR-01-5

- **FR-01-2**：`GET /api/desktop/rooms` 返回 `{ code: "00000", message: "ok", data: { rooms } }`，`rooms` 来自 `listRooms(desktopRoomContext(identity))`。无 PAT → 401（`desktopRoomUnauthorized`）。

- **FR-01-3**：`GET /api/desktop/rooms/:roomId` 返回 `{ data: { room, members, viewer_user_id } }`：
  - `room` / `members` 分别来自 `getRoom` 与 `listMembers`（并发 `Promise.all`）
  - `viewer_user_id` = `identity.userId`
  - `roomId` 非法 ULID → 400；非成员 → 403（由 `desktopRoomErrorResponse` 从 `CollabRoomForbiddenError` 映射）

  一次返回这三样是为了让桌面端首屏少两趟往返：`room.last_seq` 用于 FR-01-4 的「取最后 N 条」，`members` 用于成员区，`viewer_user_id` 用于气泡左右对齐。桌面端没有 portal 会话，无法自行得知自己的 `users.id`，所以必须由服务端告知（子 plan 03 依赖此字段）。

- **FR-01-4**：`GET /api/desktop/rooms/:roomId/messages` 支持 `?after_seq=` 与 `?limit=`，语义与 Cookie 侧 `enterprise/apps/web-portal/src/app/api/rooms/[roomId]/messages/route.ts:28-46` **完全一致**（`after_seq` 必须是 `>= 0` 的整数，否则 400；`limit` 必须是 `>= 1` 的整数，否则 400；`limit` 上限 500，默认 200）。

  **不新增 `before_seq` 参数、不改 store。** 桌面端要「最后 N 条」时的正确姿势是：先 `GET /api/desktop/rooms/:roomId` 拿 `room.last_seq`，再请求 `after_seq = Math.max(0, last_seq - N)`。这一句必须写进本文件的接口注释里，否则实施 02 的人会想去改 store。

- **FR-01-5**：`POST /api/desktop/rooms/:roomId/messages`：
  - body 只接受 `{ content: string }`。`content` trim 后为空 → 400；长度 > 8000 → 400（与 Cookie 侧 `CONTENT_MAX` 一致）。
  - **发送者只从 PAT 身份推导**：`senderType: "human"`、`senderId: identity.userId`、`senderName: desktopSenderName(identity)`。**禁止**从 body / header 读取任何 sender 字段。
  - 追加成功后，若 `mentionsMeta(content)` 为真，则 `await triggerMetaReply(ctx, roomId, desktopAuthContext(identity)).catch(...)`，失败只打日志（`log("error", { event: "room.meta_reply.failed", room_id, error_message })`，用 `../../../../../lib/observability/logger`），**POST 仍返回 200**。禁止 `void promise`（Next.js 响应返回后不保证后台任务继续执行，与 C1 子 plan 06 的取舍一致）。
  - `desktopAuthContext(identity)` 构造：
    ```ts
    // triggerMetaReply 只用到 userId / tenantId / email / deptId / sessionId / scopes：
    // sessionId 会进网关 trace 头，桌面端没有 portal 会话，用 PAT id 标注来源。
    {
      userId: identity.userId,
      tenantId: identity.tenantId,
      email: identity.email,
      deptId: identity.deptId,
      sessionId: `desktop-pat-${identity.tokenId}`,
      scopes: identity.scopes,
      mustChangePassword: false,
    }
    ```
    若 `AuthContext` 类型缺字段导致 ts 报错，按 `@agenticx/auth` 的实际定义补齐必填项，**不要**用 `as any` 绕过。

- **FR-01-6**：`GET /api/desktop/rooms/:roomId/events`（SSE）行为与 Cookie 侧 `enterprise/apps/web-portal/src/app/api/rooms/[roomId]/events/route.ts` **逐条对齐**：
  - `export const runtime = "nodejs"`、`export const maxDuration = 300`
  - 鉴权与 `getRoom` 校验在**建流之前**完成；非成员必须返回 403 JSON，而不是先开一个 `text/event-stream` 再在流里报错（测试要断言 `content-type` 不含 `text/event-stream`）
  - 首帧 `room_cursor`，带 `last_seq`
  - `POLL_MS = process.env.VITEST ? 15 : 1_000`；`PING_EVERY_MS = process.env.VITEST ? 80 : 15_000`
  - 轮询用 `listMessages(ctx, roomId, { afterSeq: cursor, limit: 200 })`；`cursor` 用 `Math.max` 推进
  - 循环里的 catch：**只有** `CollabRoomForbiddenError` / `CollabRoomNotFoundError` 才播 `room_closed`/`gone`；其它异常静默 `break`（让客户端按连接中断退回轮询，不误报「你已被移出该房间」）
  - 必须注册 abort listener 且实现 `cancel()`，否则客户端断开后轮询不停
  - 逼近 `maxDuration` 时播 `room_closed`/`timeout` 并收流

- **FR-01-7**：以上所有路由在 `resolveDesktopIdentity` 返回 `null` 时一律 401，且响应体中**不出现** PAT 明文、不出现数据库表名。

---

## 五、单测（文件名与用例名照写）

`enterprise/apps/web-portal/src/app/api/desktop/rooms/__tests__/route.test.ts`

mock 方式参照 `enterprise/apps/web-portal/src/app/api/desktop/capabilities/__tests__/route.test.ts`：`vi.mock("../../../../../lib/desktop-auth", () => ({ resolveDesktopIdentity: ... }))`，并 mock `../../../../../lib/collab-room`。

固定测试常量（合法 Crockford ULID，勿含 I/L/O/U）：

```ts
const IDENTITY = {
  userId: "01HZX3NDEKTSV4RRFFQ69G5FAV",
  tenantId: "01TENANT0AAAAAAAAAAAAAAA",
  deptId: null,
  email: "bob@example.com",
  displayName: "Bob",
  tokenId: 42,
  scopes: ["workspace:chat", "desktop:managed"],
};
const ROOM = "01R00M0AAAAAAAAAAAAAAAAAAA";
```

| 用例 | 断言 |
|---|---|
| `GET /api/desktop/rooms returns 401 without a PAT` | `resolveDesktopIdentity` 返回 null → status 401，body `code === "40101"` |
| `GET /api/desktop/rooms lists rooms for the PAT identity` | `listRooms` 收到 `{ tenantId, userId }`（来自 identity，不是 body） |
| `GET /api/desktop/rooms/:id returns room, members and viewer id` | `data.room`、`data.members` 同时存在；`data.viewer_user_id === IDENTITY.userId`；`getRoom` / `listMembers` 各调一次 |
| `GET /api/desktop/rooms/:id maps forbidden to 403` | `getRoom` 抛 `CollabRoomForbiddenError` → status 403 |
| `GET /api/desktop/rooms/:id rejects a non-ulid room id` | status 400 |

`.../__tests__/messages.test.ts`

| 用例 | 断言 |
|---|---|
| `POST messages derives the sender from the PAT identity only` | body 里塞 `sender_id: "01EVILAAAAAAAAAAAAAAAAAAAA"` 也被忽略；`appendMessage` 收到 `senderId === IDENTITY.userId`、`senderType === "human"` |
| `POST messages rejects empty content` | status 400，`appendMessage` 未被调用 |
| `POST messages rejects content over 8000 chars` | status 400 |
| `POST messages triggers a meta reply when @Meta is mentioned` | `triggerMetaReply` 被调用一次，第三个参数含 `sessionId` 以 `desktop-pat-` 开头 |
| `POST messages does not trigger a meta reply without a mention` | `triggerMetaReply` 未被调用 |
| `POST messages still returns 200 when the meta reply fails` | `triggerMetaReply` reject → status 200，且 `data.message` 仍是刚追加那条 |
| `GET messages rejects a negative after_seq` | status 400 |

`.../__tests__/events.test.ts`（读流辅助函数照抄 `enterprise/apps/web-portal/src/app/api/rooms/[roomId]/events/route.test.ts:37-51` 的 `readFrames`）

**注意两个已知坑**（C1 踩过）：`beforeEach` 里必须 `vi.mocked(listMessages).mockReset()` 后再 `mockResolvedValue([])`（用 `mockResolvedValueOnce` 会被前一用例的空数组回落覆盖）；读完帧后必须 `reader.cancel()`。

| 用例 | 断言 |
|---|---|
| `events returns 401 without a PAT` | status 401 |
| `events returns 403 for a non-member before opening a stream` | status 403，且 `content-type` 不含 `text/event-stream` |
| `events first frame is room_cursor` | 首帧含 `event: room_cursor` 与 `"last_seq":5` |
| `events pushes messages after the cursor` | `listMessages` 收到 `afterSeq` = 请求值；帧含 `event: room_message` |
| `events emits room_closed gone when membership is revoked` | `listMessages` 抛 Forbidden → 帧含 `"reason":"gone"`，流正常结束（非 error） |
| `events does not claim revocation for other store failures` | `listMessages` 抛 `new Error("connection reset")` → 帧**不含** `"reason":"gone"` |
| `events stops polling after client abort` | abort 后 `listMessages` 调用次数不再增长 |

---

## 六、AC

- **AC-01-1**：`pnpm -C enterprise/apps/web-portal test` 全绿，含上表全部用例。
- **AC-01-2**：`git diff --name-only` 只含本子 plan「落点清单」里的 10 个新文件。特别是 `git diff --name-only | grep -E 'app/api/rooms/|lib/collab-room/'` **必须为空**（证明没碰 C1 的路由与 store）。
- **AC-01-3**：真库联调（先按父 plan「真库前置」起栈）。用 admin-console 或 portal 设置页给测试账号签一个 PAT（`agx-pat-*`），或直接复用桌面设备授权流签发的 PAT，然后：
  ```bash
  PAT=agx-pat-xxxx   # 不要把它写进任何提交物
  curl -sS --noproxy '*' -H "Authorization: Bearer $PAT" http://localhost:3000/api/desktop/rooms
  curl -sS --noproxy '*' -H "Authorization: Bearer $PAT" http://localhost:3000/api/desktop/rooms/<ROOM_ID>
  curl -sS --noproxy '*' -H "Authorization: Bearer $PAT" -H 'content-type: application/json' \
       -d '{"content":"来自桌面 PAT 的一条"}' \
       http://localhost:3000/api/desktop/rooms/<ROOM_ID>/messages
  ```
  预期：列表含该账号所在房间；POST 200；浏览器端同一房间 ≤2s 内看到这条，且 `sender_name` 是该账号显示名 / 邮箱。
- **AC-01-4**：`curl -N --noproxy '*' -H "Authorization: Bearer $PAT" http://localhost:3000/api/desktop/rooms/<ROOM_ID>/events`，浏览器侧发一条，SSE 在 ≤2s 内收到 `event: room_message`。
- **AC-01-5**：非成员 PAT（另一个账号的 PAT）访问同一 `roomId`，`/api/desktop/rooms/<id>` 与 `/events` 均 403。
- **AC-01-6**：`docker exec <mysql 容器> mysql ... -e "SELECT COUNT(*) FROM chat_messages;"` 在整轮 curl 前后不变（云房间不写个人聊天表）。

---

## 七、In scope / Out of scope

**In scope：** 上述 10 个新文件。

**Out of scope（实施者不要顺手做）：**

- 改 `enterprise/apps/web-portal/src/app/api/rooms/**`（C1 Cookie 路由）
- 改 `enterprise/apps/web-portal/src/lib/collab-room/**`（store 与 meta-reply）
- 新增 `before_seq` / 倒序分页（见 FR-01-4 的替代姿势）
- 桌面端的建房 / 加成员 / 移出 / 离开写接口（C3 桌面端成员区只读）
- 为 PAT 路由另发明一套错误码或响应包装
- 改 `enterprise/apps/gateway`、`admin-console`、`agenticx/studio/server.py`

---

## 八、易错点

| 坑 | 规避 |
|---|---|
| 在 Cookie 路由里加 Bearer 分支 | AC-01-2 用 `git diff --name-only` 兜底 |
| SSE 先返回 200 事件流再报无权 | 鉴权 + `getRoom` 必须在 `new ReadableStream` 之前；测试断言 `content-type` |
| 任何异常都播 `gone` | 只对 Forbidden / NotFound 播；其它静默收流（C1 已修同一处） |
| 客户端断开后轮询不停 | abort listener + `cancel()` 双保险 |
| `triggerMetaReply` 用 `void` 异步 | 必须 `await ... .catch()`；POST 仍 200 |
| 从 body 读 sender | 只从 `identity` 推导，测试用「body 塞恶意 sender_id」兜底 |
| 日志打 PAT | 只打 `tokenId`，不打 token 明文 |
| 单测 import 打到 `next/headers` | 只 mock `../../../../../lib/desktop-auth` 与 `../../../../../lib/collab-room`，不要 import `lib/session` |
