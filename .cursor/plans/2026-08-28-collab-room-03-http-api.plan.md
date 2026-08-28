# 协作房间 03 · HTTP API

Planned-with: claude-opus-5
Suggested-Impl-Model: cursor-grok-4.6-xhigh-fast

**Master:** `.cursor/plans/2026-08-28-collab-room-master.plan.md`
**依赖:** 子 plan 02（store 可用）
**交付:** web-portal 下 `/api/rooms/*` 路由 + 错误映射 + 路由级单测

---

## In scope

- 6 个路由文件（见落点清单）
- 统一错误映射：store 错误类 → 既有 portal 错误响应
- 路由单测（mock store，不需要真库）

## Out of scope

- SSE 事件流（子 plan 04，独立路由）
- UI（子 plan 05）
- 模型调用（子 plan 06）
- 修改 `lib/chat-history*` 任何文件
- 新增 RBAC scope（本波次房间不引入新 scope，见下节「为什么不加 scope」）

---

## 为什么不新增 RBAC scope

现有角色种子（`enterprise/packages/iam-core/src/repos/roles.ts:128`）里 `member` 角色已有 `workspace:chat`。房间的授权边界由**成员表**承担（M1），不是全局 scope：一个人能不能进某房间取决于他在不在该房间成员里，而不是他有没有某个平台权限位。

因此本波次**不新增 scope、不改 `scope-registry`、不改角色种子**。仅要求已登录且非 `mustChangePassword`。

---

## FR

- **FR-03-1**：所有路由未登录返回 401；`session.mustChangePassword` 时返回既有的改密响应。
- **FR-03-2**：`CollabRoomForbiddenError` → 403、`CollabRoomNotFoundError` → 404、`CollabRoomBadRequestError` → 400、其他 → 500。
- **FR-03-3**：响应体沿用 portal 既有约定：成功 `{ code: "00000", message: "ok", data: {...} }`；失败 `{ error: { code, message } }`。
- **FR-03-4**：`POST /api/rooms` 创建者自动成为 `owner` 活跃成员，并自动加入一个 `meta` 成员行。
- **FR-03-5**：`GET /api/rooms/:roomId/messages?after_seq=N` 支持增量拉取。
- **FR-03-6**：房间数据不出现在 `/api/chat/sessions` 的响应里（该路由零改动即自然满足，用测试固定住）。

---

## 落点清单（全部新建）

```
enterprise/apps/web-portal/src/app/api/rooms/
├── route.ts                                  # GET 列表 / POST 创建
├── [roomId]/route.ts                         # GET 详情
├── [roomId]/members/route.ts                 # GET 列表 / POST 添加成员
├── [roomId]/members/[memberId]/route.ts      # DELETE 移出成员
├── [roomId]/leave/route.ts                   # POST 主动离开
└── [roomId]/messages/route.ts                # GET 历史(可增量) / POST 发言
```

新建错误映射工具：

```
enterprise/apps/web-portal/src/lib/collab-room-http.ts
enterprise/apps/web-portal/src/lib/collab-room-http.test.ts
```

---

## 错误映射（`lib/collab-room-http.ts`）

复用既有响应工具，不要新造错误码体系：

```ts
import type { AuthContext } from "@agenticx/auth";
import {
  chatHistoryBadRequest,
  chatHistoryForbidden,
  chatHistoryNotFound,
  chatHistoryServerError,
  chatHistoryUnauthorized,
} from "./chat-history-http";
import {
  CollabRoomBadRequestError,
  CollabRoomForbiddenError,
  CollabRoomNotFoundError,
  type CollabRoomContext,
} from "./collab-room";

export function toCollabRoomContext(session: AuthContext): CollabRoomContext {
  return { tenantId: session.tenantId, userId: session.userId };
}

export { chatHistoryUnauthorized as collabRoomUnauthorized };

/** 把 store 领域错误映射为 portal 既有的 HTTP 响应形状。 */
export function collabRoomErrorResponse(error: unknown) {
  if (error instanceof CollabRoomForbiddenError) return chatHistoryForbidden();
  if (error instanceof CollabRoomNotFoundError) return chatHistoryNotFound();
  if (error instanceof CollabRoomBadRequestError) return chatHistoryBadRequest(error.message);
  return chatHistoryServerError(error);
}
```

> 复用 `chat-history-http.ts` 的函数是刻意的：错误码 `40101/40301/40401/40001/50001` 已被前端与日志消费，房间不该再引入第二套。**但不要修改 `chat-history-http.ts` 本身。**

---

## 路由骨架（照 `api/chat/sessions/route.ts:10-50` 的写法）

`app/api/rooms/route.ts`：

```ts
import { NextResponse } from "next/server";
import { getSessionFromCookies, passwordChangeRequiredResponse } from "../../../lib/session";
import { collabRoomErrorResponse, collabRoomUnauthorized, toCollabRoomContext } from "../../../lib/collab-room-http";
import { createRoom, listRooms } from "../../../lib/collab-room";

export async function GET() {
  const session = await getSessionFromCookies();
  if (!session) return collabRoomUnauthorized();
  if (session.mustChangePassword) return passwordChangeRequiredResponse();
  try {
    const rooms = await listRooms(toCollabRoomContext(session));
    return NextResponse.json({ code: "00000", message: "ok", data: { rooms } });
  } catch (error) {
    return collabRoomErrorResponse(error);
  }
}

export async function POST(request: Request) {
  const session = await getSessionFromCookies();
  if (!session) return collabRoomUnauthorized();
  if (session.mustChangePassword) return passwordChangeRequiredResponse();
  let body: { title?: unknown };
  try {
    body = (await request.json()) as { title?: unknown };
  } catch {
    body = {};
  }
  const title = typeof body.title === "string" && body.title.trim() ? body.title.trim() : "新房间";
  try {
    const room = await createRoom(toCollabRoomContext(session), {
      title,
      displayName: session.email ?? session.userId,
    });
    return NextResponse.json({ code: "00000", message: "ok", data: { room } });
  } catch (error) {
    return collabRoomErrorResponse(error);
  }
}
```

**相对路径深度**：`app/api/rooms/route.ts` → `../../../lib/...`；`app/api/rooms/[roomId]/messages/route.ts` → `../../../../../lib/...`。实施时按目录层级数清，参考 `api/chat/sessions/[sessionId]/messages/route.ts:1-10` 的写法（它用了 6 层 `../`）。

### 各路由请求/响应契约

| 路由 | 方法 | 请求 | 成功 data |
|---|---|---|---|
| `/api/rooms` | GET | — | `{ rooms: CollabRoom[] }` |
| `/api/rooms` | POST | `{ title?: string }` | `{ room: CollabRoom }` |
| `/api/rooms/:roomId` | GET | — | `{ room: CollabRoom, members: CollabRoomMember[] }` |
| `/api/rooms/:roomId/members` | GET | — | `{ members: CollabRoomMember[] }` |
| `/api/rooms/:roomId/members` | POST | `{ user_id: string, display_name?: string, role?: "admin"\|"member" }` | `{ member: CollabRoomMember }` |
| `/api/rooms/:roomId/members/:memberId` | DELETE | — | `{}` |
| `/api/rooms/:roomId/leave` | POST | — | `{}` |
| `/api/rooms/:roomId/messages` | GET | query `after_seq?`、`limit?`（默认 200，上限 500） | `{ messages: CollabRoomMessage[] }` |
| `/api/rooms/:roomId/messages` | POST | `{ content: string }` | `{ message: CollabRoomMessage }` |

`POST /messages` 的 `sender*` 由服务端从 session 推导，**不接受客户端传入**（否则可冒充他人）：

```ts
await appendMessage(ctx, roomId, {
  senderType: "human",
  senderId: session.userId,
  senderName: session.email ?? session.userId,
  content,
});
```

参数校验：
- `roomId` / `memberId`：ULID 校验，正则 `^[0-7][0-9A-HJKMNP-TV-Z]{25}$`（与 `lib/chat-history.ts:17` 同一份规则；可从那里 import `isValidUlid`，它已被导出）。不合法 → 400。
- `after_seq`：`Number.isInteger` 且 ≥ 0，否则 400。
- `content`：trim 后非空且 ≤ 8000 字符，否则 400。

Next.js 15 动态段是 Promise：`segmentData: { params: Promise<{ roomId: string }> }`，用 `const { roomId } = await segmentData.params;`（见 `api/chat/sessions/[sessionId]/messages/route.ts:21,29`）。

---

## 单测（`lib/collab-room-http.test.ts` + 路由测试）

路由测试放在各自目录下的 `route.test.ts`，`vi.mock` 掉 `../../../lib/collab-room` 与 `../../../lib/session`。参考既有 `api/chat/completions/route.trace.test.ts` 的 mock 风格。

必须覆盖：

| 用例 | 断言 |
|---|---|
| `GET /api/rooms returns 401 without session` | status 401，body `error.code === "40101"` |
| `GET /api/rooms maps Forbidden to 403` | store 抛 `CollabRoomForbiddenError` → 403 / `40301` |
| `GET /api/rooms/:id maps NotFound to 404` | 404 / `40401` |
| `POST /api/rooms/:id/messages rejects client-supplied sender` | 请求体带 `sender_id: "someone-else"`，落到 store 的 `senderId` 仍是 session.userId |
| `POST /api/rooms/:id/messages rejects empty content` | 400，且 store 未被调用 |
| `POST /api/rooms/:id/messages rejects invalid room id` | 400，store 未被调用 |
| `GET messages passes after_seq through to the store` | store 收到 `{ afterSeq: 7 }` |
| `GET messages rejects negative after_seq` | 400 |
| `POST /api/rooms creates owner + meta members` | store `createRoom` 被调用一次；断言在 store 契约层（成员创建实现在子 plan 02 的 `createRoom` 内） |

---

## AC

- **AC-03-1**：`pnpm -C enterprise/apps/web-portal test` 全绿，含上表全部用例。
- **AC-03-2**：`pnpm -C enterprise typecheck` 与 `pnpm -C enterprise build` 通过。
- **AC-03-3**：真库联调（先 `bash enterprise/scripts/start-dev-with-infra.sh`），用两个账号验证：
  1. 账号 A `POST /api/rooms` 建房 → 返回 `room.id`
  2. A `POST /api/rooms/{id}/messages` 发一条
  3. 账号 B 直接 `GET /api/rooms/{id}` → **403**
  4. A `POST /api/rooms/{id}/members` 把 B 加入 → B `GET /api/rooms/{id}/messages` 能看到 A 那条
  5. A `DELETE /api/rooms/{id}/members/{B 的 member id}` → B 再访问 → **403**
  6. 数据库里 B 的成员行仍存在且 `left_at` 非空（证明 FR-03/M1）
- **AC-03-4**：`GET /api/chat/sessions` 的返回中不含任何房间数据（用 curl 或路由测试固定）。
- **AC-03-5**：`git diff --name-only` 不含 `lib/chat-history*` 与 `app/api/chat/**`。

---

## 风险与对策

| 风险 | 对策 |
|---|---|
| 相对 import 路径层级数错 | 每个文件建好后先 typecheck，别一次写完六个再编译 |
| 把 403 写成 404（或反之）导致前端行为错 | 单测逐个固定；不要为了「防探测」把 403 改成 404，房间 id 不是可枚举的敏感资源 |
| 客户端伪造 sender | 服务端强制从 session 推导，单测断言 |
| 顺手在 `/api/chat/sessions` 里混入房间 | AC-03-4 + AC-03-5 双重兜底 |
| 用 `window.confirm` 之类原生交互 | 本子 plan 无 UI，禁止在此引入 |
