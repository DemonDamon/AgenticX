# 协作房间 02 · Store 与成员鉴权

Planned-with: claude-opus-5
Suggested-Impl-Model: cursor-grok-4.6-xhigh-fast

**Master:** `.cursor/plans/2026-08-28-collab-room-master.plan.md`
**依赖:** 子 plan 01（表已存在）
**交付:** `room-store` 数据访问层 + 成员鉴权 + `seq` 分配 + 单测

> 本子 plan 是整波次**安全最敏感**的一环。可见性判定写错等于让人看到别人房间的对话。所有查询都必须带成员校验，宁可多一次 join 也不要「先查再信」。

---

## In scope

- 新建 `enterprise/apps/web-portal/src/lib/collab-room/` 目录：类型、SQL store、方言绑定、facade
- 成员鉴权：`requireActiveMember()` 语义（活跃成员 = `left_at IS NULL` 且 `tenant_id` 匹配）
- 消息追加时在事务内分配房间内单调 `seq`
- 单测（用 fake `SqlClient`，不需要真库）

## Out of scope

- HTTP 路由（子 plan 03）
- SSE（子 plan 04）
- UI（子 plan 05）
- 模型调用（子 plan 06）
- **任何对 `lib/chat-history/**` 的修改**（可以 import 其类型，不可改其代码）

---

## 复用而非重造（重要）

`SqlClient` / `SqlResult` / `SqlDialect` 已在 `enterprise/apps/web-portal/src/lib/chat-history/sql-store.ts:19-30` 定义并导出。**直接 import 复用**：

```ts
import type { SqlClient, SqlDialect, SqlResult } from "../chat-history/sql-store";
```

PG 连接池与事务实现见 `lib/chat-history/postgresql.ts:13-55`；MySQL 见 `lib/chat-history/mysql.ts`。本子 plan 采用同样模式**新建独立的池绑定文件**（不要复用 chat-history 导出的 store 实例，那是给个人历史用的）。

错误类型也复用既有约定风格，但放在自己的命名空间下（见下文 `types.ts`）。

---

## FR

- **FR-02-1**：`listRooms(ctx)` 只返回调用者当前是活跃成员的房间。
- **FR-02-2**：`getRoom` / `listMessages` / `appendMessage` 在调用者不是活跃成员时抛 `CollabRoomForbiddenError`；房间不存在时抛 `CollabRoomNotFoundError`。两者可区分。
- **FR-02-3**：`appendMessage` 在同一事务内取 `max(seq)+1` 并插入，唯一索引冲突时重试（≤3 次）。
- **FR-02-4**：`leaveRoom` / `removeMember` 只写 `left_at`，不执行 DELETE。
- **FR-02-5**：`addHumanMember` 校验目标 `users.id` 属于同一 `tenant_id`，否则抛 `CollabRoomBadRequestError`。
- **FR-02-6**：`listMessages(ctx, roomId, { afterSeq })` 支持增量拉取，返回按 `seq` 升序。

---

## 落点清单（精确路径，全部新建）

```
enterprise/apps/web-portal/src/lib/collab-room/
├── types.ts            # 领域类型 + 错误类
├── sql-store.ts        # SqlCollabRoomStore（方言无关 SQL）
├── postgresql.ts       # PG 池绑定
├── mysql.ts            # MySQL 池绑定
├── index.ts            # facade：按 resolveDatabaseConfig() 选方言并转发
└── sql-store.test.ts   # 单测（fake SqlClient）
```

**不修改任何既有文件。** 子 plan 03 才会有 route 引用它。

---

## `types.ts` 契约（照此定义）

```ts
export type CollabRoomContext = {
  tenantId: string;
  userId: string;
};

export type CollabMemberType = "human" | "meta" | "agent";
export type CollabSenderType = CollabMemberType | "system";
export type CollabRoomRole = "owner" | "admin" | "member";

export type CollabRoom = {
  id: string;
  tenant_id: string;
  title: string;
  created_by: string;
  archived_at?: string;
  member_count: number;      // 活跃成员数（human + meta + agent）
  last_message_at?: string;
  last_seq: number;          // 房间当前最大 seq；无消息时 0
  created_at: string;
  updated_at: string;
};

export type CollabRoomMember = {
  id: string;
  room_id: string;
  member_type: CollabMemberType;
  member_id: string;
  display_name: string;
  room_role: CollabRoomRole;
  joined_at: string;
  left_at?: string;
};

export type CollabRoomMessage = {
  id: string;
  room_id: string;
  tenant_id: string;
  seq: number;
  sender_type: CollabSenderType;
  sender_id: string;
  sender_name: string;
  content: string;
  model?: string;
  metadata?: Record<string, unknown>;
  created_at: string;
};

export class CollabRoomNotFoundError extends Error {
  public constructor(message = "room not found") {
    super(message);
    this.name = "CollabRoomNotFoundError";
  }
}

export class CollabRoomForbiddenError extends Error {
  public constructor(message = "not a room member") {
    super(message);
    this.name = "CollabRoomForbiddenError";
  }
}

export class CollabRoomBadRequestError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "CollabRoomBadRequestError";
  }
}

export interface CollabRoomStore {
  listRooms(ctx: CollabRoomContext): Promise<CollabRoom[]>;
  createRoom(ctx: CollabRoomContext, input: { title: string; displayName: string }): Promise<CollabRoom>;
  getRoom(ctx: CollabRoomContext, roomId: string): Promise<CollabRoom>;
  listMembers(ctx: CollabRoomContext, roomId: string): Promise<CollabRoomMember[]>;
  addHumanMember(
    ctx: CollabRoomContext,
    roomId: string,
    input: { userId: string; displayName: string; role?: CollabRoomRole },
  ): Promise<CollabRoomMember>;
  removeMember(ctx: CollabRoomContext, roomId: string, memberId: string): Promise<void>;
  leaveRoom(ctx: CollabRoomContext, roomId: string): Promise<void>;
  listMessages(
    ctx: CollabRoomContext,
    roomId: string,
    options?: { afterSeq?: number; limit?: number },
  ): Promise<CollabRoomMessage[]>;
  appendMessage(
    ctx: CollabRoomContext,
    roomId: string,
    input: {
      senderType: CollabSenderType;
      senderId: string;
      senderName: string;
      content: string;
      model?: string;
      metadata?: Record<string, unknown>;
    },
  ): Promise<CollabRoomMessage>;
  resetForTests(): void | Promise<void>;
}
```

---

## 鉴权实现（M1 的唯一落点）

`sql-store.ts` 内私有方法，**所有需要房间上下文的公开方法第一步都调它**：

```ts
/**
 * 活跃成员校验。房间存在但调用者不是活跃成员 → Forbidden；
 * 房间不存在（或被 archive 后仍允许读，见下）→ NotFound。
 * 语义刻意与「离开只写 left_at」配套：left_at 非空的人等价于非成员。
 */
private async requireActiveMember(
  client: SqlClient,
  ctx: CollabRoomContext,
  roomId: string,
): Promise<CollabRoomMember> {
  const p = this.dialect === "postgresql";
  const room = await client.query(
    `select id from enterprise_collab_rooms
      where id = ${p ? "$1" : "?"} and tenant_id = ${p ? "$2" : "?"} limit 1`,
    [roomId, ctx.tenantId],
  );
  if (!room.rows[0]) throw new CollabRoomNotFoundError();

  const member = await client.query(
    `select * from enterprise_collab_room_members
      where room_id = ${p ? "$1" : "?"}
        and tenant_id = ${p ? "$2" : "?"}
        and member_type = 'human'
        and member_id = ${p ? "$3" : "?"}
        and left_at is null
      limit 1`,
    [roomId, ctx.tenantId, ctx.userId],
  );
  if (!member.rows[0]) throw new CollabRoomForbiddenError();
  return mapMember(member.rows[0]);
}
```

**禁止**出现「先按 roomId 查消息，再判断有没有权限」的顺序。查询本身必须在鉴权之后。

`listRooms` 不走 `requireActiveMember`，而是直接以成员表为驱动表：

```sql
select r.*,
       (select count(*) from enterprise_collab_room_members m2
         where m2.room_id = r.id and m2.left_at is null) as member_count,
       (select max(seq) from enterprise_collab_room_messages g
         where g.room_id = r.id) as last_seq,
       (select max(created_at) from enterprise_collab_room_messages g2
         where g2.room_id = r.id) as last_message_at
  from enterprise_collab_rooms r
  join enterprise_collab_room_members m
    on m.room_id = r.id
   and m.left_at is null
   and m.member_type = 'human'
   and m.member_id = $2
 where r.tenant_id = $1
 order by r.updated_at desc
```

---

## `seq` 分配（M3 的唯一落点）

```ts
public async appendMessage(ctx, roomId, input): Promise<CollabRoomMessage> {
  if (!input.content?.trim()) throw new CollabRoomBadRequestError("content required");
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await this.client.transaction(async (tx) => {
        await this.requireActiveMember(tx, ctx, roomId);
        const p = this.dialect === "postgresql";
        const maxRow = await tx.query(
          `select coalesce(max(seq), 0) as max_seq from enterprise_collab_room_messages
            where room_id = ${p ? "$1" : "?"}`,
          [roomId],
        );
        const nextSeq = Number(maxRow.rows[0]?.max_seq ?? 0) + 1;
        const id = ulid();
        const now = new Date();
        await tx.query(
          `insert into enterprise_collab_room_messages
            (id, room_id, tenant_id, seq, sender_type, sender_id, sender_name,
             content, model, metadata, created_at, updated_at)
           values (${this.placeholders(12)})`,
          [id, roomId, ctx.tenantId, nextSeq, input.senderType, input.senderId,
           input.senderName, input.content, input.model ?? null,
           input.metadata ? JSON.stringify(input.metadata) : null, now, now],
        );
        await tx.query(
          `update enterprise_collab_rooms set updated_at = ${p ? "$1" : "?"}
            where id = ${p ? "$2" : "?"}`,
          [now, roomId],
        );
        return { /* mapped message */ } as CollabRoomMessage;
      });
    } catch (error) {
      if (attempt === 2 || !isUniqueViolation(error)) throw error;
      // 并发写同一房间撞 (room_id, seq) 唯一索引：重取 max 再试。
    }
  }
  throw new Error("unreachable");
}
```

`isUniqueViolation(error)`：PG 判 `(error as { code?: string }).code === "23505"`；MySQL 判 `code === "ER_DUP_ENTRY"` 或 `errno === 1062`。写成模块内小函数，同时覆盖两种。

`metadata` 一律传 **JSON 字符串**（与 `chat-history/sql-store.ts:104-107` 的注释同因：mysql2 对 JSON 列拒绝 JS 对象）。

---

## `index.ts` facade（照 `lib/chat-history.ts:23-35` 的模式）

```ts
import { resolveDatabaseConfig } from "@agenticx/iam-core";
import { mysqlCollabRoomStore } from "./mysql";
import { postgresqlCollabRoomStore } from "./postgresql";

function store(): CollabRoomStore {
  const config = resolveDatabaseConfig();
  switch (config.dialect) {
    case "postgresql": return postgresqlCollabRoomStore;
    case "mysql": return mysqlCollabRoomStore;
    default: {
      const exhaustive: never = config;
      throw new Error(`Unsupported database config: ${JSON.stringify(exhaustive)}`);
    }
  }
}
// 之后逐个方法转发，并 re-export types.ts 的类型与错误类
```

> `default` 分支的 `never` 穷尽检查是本仓的既有约定（`lib/chat-history.ts:30-33`），也是 workspace rule `typescript-exhaustive-switch` 的要求，必须保留。

PG 池绑定 `postgresql.ts` 照抄 `lib/chat-history/postgresql.ts` 结构，但用**独立的 global 变量名**避免与个人历史池冲突：

```ts
declare global { var __agenticxPortalCollabRoomPgPool: Pool | undefined; }
```

---

## 单测（`sql-store.test.ts`，必须覆盖以下用例）

用 fake `SqlClient`（按语句前缀返回预置 rows），参考 `lib/chat-history/append-idempotent.test.ts:28,109` 的假客户端写法。

| 用例名 | 断言 |
|---|---|
| `listRooms only returns rooms where caller is an active member` | SQL 含 `left_at is null` 且带 `member_id` 绑定；`left_at` 非空的房间不出现 |
| `getRoom throws Forbidden for non-member of an existing room` | 抛 `CollabRoomForbiddenError`，**不是** NotFound（避免把「无权」伪装成「不存在」而丢失可诊断性） |
| `getRoom throws NotFound for unknown room id` | 抛 `CollabRoomNotFoundError` |
| `getRoom throws NotFound when room belongs to another tenant` | 跨租户按不存在处理 |
| `listMessages requires membership before querying messages` | 断言 fake client 的调用顺序：成员查询先于消息查询 |
| `appendMessage assigns max(seq)+1 inside a transaction` | 插入参数中 `seq === 4`（预置 max 为 3），且发生在 `transaction` 回调内 |
| `appendMessage retries once on unique violation` | 第一次插入抛 `{code:"23505"}`，第二次成功；总插入尝试 2 次 |
| `appendMessage rejects empty content` | 抛 `CollabRoomBadRequestError` |
| `leaveRoom issues an update to left_at and never a delete` | 捕获的 SQL 含 `update` + `left_at`，且不含 `delete from` |
| `removeMember never deletes the member row` | 同上 |
| `addHumanMember rejects a user from another tenant` | 抛 `CollabRoomBadRequestError` |
| `listMessages afterSeq filters by seq greater than cursor` | SQL 含 `seq >` 且绑定为传入游标 |

---

## AC

- **AC-02-1**：`pnpm -C enterprise/apps/web-portal test` 中新增的 `collab-room/sql-store.test.ts` 全部通过（≥12 个用例，覆盖上表）。
- **AC-02-2**：`pnpm -C enterprise typecheck` 通过。
- **AC-02-3**：`git diff --name-only` 只包含 `enterprise/apps/web-portal/src/lib/collab-room/` 下的新文件，无既有文件被修改。
- **AC-02-4**：`grep -rn "delete from enterprise_collab" enterprise/apps/web-portal/src/lib/collab-room/` 无输出（证明 FR-02-4）。
- **AC-02-5**：`grep -rn "user_id" enterprise/apps/web-portal/src/lib/collab-room/sql-store.ts` 无输出——房间可见性一律走 `member_id`，出现 `user_id` 说明混进了个人历史模型。

---

## 风险与对策

| 风险 | 对策 |
|---|---|
| 把「无权」返回成 NotFound 或反之 | 两个错误类分开，单测各自断言；HTTP 映射在子 plan 03 |
| 复用了个人历史的 store 实例导致池串用 | 新建独立池文件 + 独立 global 变量名 |
| 并发写 seq 死循环 | 重试上限 3，超限抛原错误 |
| MySQL JSON 列报 `ER_INVALID_JSON_TEXT` | metadata 一律 `JSON.stringify` 后绑定 |
| 顺手「优化」个人聊天 store | AC-02-3 用 diff 文件列表兜底 |
