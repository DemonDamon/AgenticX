# 协作房间 01 · 表结构与迁移

Planned-with: claude-opus-5
Suggested-Impl-Model: cursor-grok-4.6-xhigh-fast

**Master:** `.cursor/plans/2026-08-28-collab-room-master.plan.md`
**依赖:** 无
**交付:** 三张新表 × PG/MySQL 双方言 schema + 两份迁移 SQL + 清单类测试断言更新

---

## 背景与根因（为什么新建表而不是改造 `chat_sessions`）

`chat_sessions` 是**个人助手历史**：`enterprise/packages/db-schema/src/schema/chat-sessions.ts:25-44` 的四个索引全部以 `(tenant_id, user_id, …)` 为前缀，portal 的读写查询（`enterprise/apps/web-portal/src/lib/chat-history/sql-store.ts:141-201`）也全部带 `user_id = $3`。把它改成「多人共享」等于同时改所有索引与所有查询，且任何漏改都是越权。

因此本波次**新建独立表**，个人历史零改动。

---

## In scope

- 新建 3 张表：`enterprise_collab_rooms`、`enterprise_collab_room_members`、`enterprise_collab_room_messages`
- PG schema 文件 + MySQL schema 文件 + 两个 `index.ts` 导出
- PG 迁移 `0049_enterprise_collab_rooms.sql` + MySQL 迁移 `0023_enterprise_collab_rooms.sql`
- 更新 `migration-inventory.test.ts` 与 `schema-parity.test.ts` 中的强断言数字与清单

## Out of scope

- 任何 store / API / UI 代码（属于子 plan 02+）
- 附件、引用（@ 文档）、CRDT 相关表
- 修改任何既有表的列或索引
- 修改 `drizzle.config.ts` / `drizzle.pg.config.ts` / `drizzle.mysql.config.ts`

---

## FR

- **FR-01-1**：三张表在 PG 与 MySQL 两个方言下均存在，且 `schema-parity.test.ts` 判定列名、可空性、逻辑类型一致。
- **FR-01-2**：成员表支持 `left_at`（离开不删行），并对「同一房间同一成员」唯一。
- **FR-01-3**：消息表带房间内单调 `seq`，且 `(room_id, seq)` 唯一。
- **FR-01-4**：迁移文件遵守 drizzle 的 `--> statement-breakpoint` 规则，且不声明 charset/collation。

---

## 表设计（照此实施，字段不要增删）

### `enterprise_collab_rooms`

| 列 | 类型 | 约束 |
|---|---|---|
| `id` | varchar(26) | PK（ULID） |
| `tenant_id` | varchar(26) | NOT NULL，FK → `tenants.id` ON DELETE CASCADE |
| `title` | varchar(160) | NOT NULL |
| `created_by` | varchar(26) | NOT NULL，FK → `users.id` ON DELETE RESTRICT |
| `archived_at` | timestamptz | NULL |
| `created_at` / `updated_at` | timestamptz | NOT NULL DEFAULT now()（用 `auditColumns`） |

索引：`enterprise_collab_rooms_tenant_updated_idx` on (`tenant_id`, `updated_at`)

### `enterprise_collab_room_members`

| 列 | 类型 | 约束 |
|---|---|---|
| `id` | varchar(26) | PK（ULID） |
| `room_id` | varchar(26) | NOT NULL，FK → `enterprise_collab_rooms.id` ON DELETE CASCADE |
| `tenant_id` | varchar(26) | NOT NULL |
| `member_type` | varchar(16) | NOT NULL；取值 `human` / `meta` / `agent` |
| `member_id` | varchar(64) | NOT NULL；`human` 时为 `users.id`，`meta` 固定 `meta`，`agent` 为分身标识 |
| `display_name` | varchar(64) | NOT NULL |
| `room_role` | varchar(16) | NOT NULL DEFAULT `'member'`；取值 `owner` / `admin` / `member` |
| `joined_at` | timestamptz | NOT NULL DEFAULT now() |
| `left_at` | timestamptz | NULL ← **M1 的落点** |
| `created_at` / `updated_at` | timestamptz | `auditColumns` |

索引：
- `enterprise_collab_room_members_room_member_uq` UNIQUE on (`room_id`, `member_type`, `member_id`)
- `enterprise_collab_room_members_lookup_idx` on (`tenant_id`, `member_id`, `left_at`)

> `member_id` 用 varchar(64) 而不是 ulid(26)：`meta` / agent 标识不是 ULID。因此**不能**对它加 FK 到 `users`。human 成员的合法性由 store 层校验（子 plan 02）。

### `enterprise_collab_room_messages`

| 列 | 类型 | 约束 |
|---|---|---|
| `id` | varchar(26) | PK（ULID） |
| `room_id` | varchar(26) | NOT NULL，FK → `enterprise_collab_rooms.id` ON DELETE CASCADE |
| `tenant_id` | varchar(26) | NOT NULL |
| `seq` | bigint | NOT NULL ← **M3 的落点** |
| `sender_type` | varchar(16) | NOT NULL；`human` / `meta` / `agent` / `system` |
| `sender_id` | varchar(64) | NOT NULL |
| `sender_name` | varchar(64) | NOT NULL |
| `content` | text | NOT NULL |
| `model` | varchar(160) | NULL |
| `metadata` | jsonb（MySQL: json） | NULL |
| `created_at` / `updated_at` | timestamptz | `auditColumns` |

索引：
- `enterprise_collab_room_messages_room_seq_uq` UNIQUE on (`room_id`, `seq`)
- `enterprise_collab_room_messages_room_created_idx` on (`room_id`, `created_at`)

---

## 落点清单（精确路径）

### 新建文件

1. `enterprise/packages/db-schema/src/schema/collab-rooms.ts`
2. `enterprise/packages/db-schema/src/mysql-schema/collab-rooms.ts`
3. `enterprise/packages/db-schema/drizzle/0049_enterprise_collab_rooms.sql`
4. `enterprise/packages/db-schema/drizzle-mysql/0023_enterprise_collab_rooms.sql`

### 修改文件

5. `enterprise/packages/db-schema/src/schema/index.ts` — 在文件末尾追加一行 `export * from "./collab-rooms";`
6. `enterprise/packages/db-schema/src/mysql-schema/index.ts` — 同样追加一行
7. `enterprise/packages/db-schema/drizzle/meta/_journal.json` — 追加 idx 49 条目
8. `enterprise/packages/db-schema/drizzle-mysql/meta/_journal.json` — 追加 idx 23 条目
9. `enterprise/packages/db-schema/src/__tests__/migration-inventory.test.ts` — 更新断言（下节给出精确 before/after）
10. `enterprise/packages/db-schema/src/__tests__/schema-parity.test.ts` — 更新断言（下节给出）

---

## PG schema 写法（`src/schema/collab-rooms.ts` 骨架）

参考同目录 `user-groups.ts:10-48` 的风格。

```ts
import { bigint, index, jsonb, pgTable, text, timestamp, uniqueIndex, varchar } from "drizzle-orm/pg-core";

import { auditColumns, ulid } from "./_shared";
import { tenants } from "./tenants";
import { users } from "./users";

export const enterpriseCollabRooms = pgTable(
  "enterprise_collab_rooms",
  {
    id: ulid("id").primaryKey(),
    tenantId: ulid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    title: varchar("title", { length: 160 }).notNull(),
    createdBy: ulid("created_by").notNull().references(() => users.id, { onDelete: "restrict" }),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    ...auditColumns,
  },
  (table) => ({
    tenantUpdatedIdx: index("enterprise_collab_rooms_tenant_updated_idx").on(table.tenantId, table.updatedAt),
  })
);
// … members / messages 同理
export type EnterpriseCollabRoomRow = typeof enterpriseCollabRooms.$inferSelect;
```

**注意 `seq` 的写法**：PG 用 `bigint("seq", { mode: "number" })`，MySQL 用 `bigint("seq", { mode: "number" })`，两边 `mode` 必须一致，否则 parity 测试的逻辑类型比对会失败。

---

## 迁移 SQL（`drizzle/0049_enterprise_collab_rooms.sql`）

规范：每两条语句之间必须有 `--> statement-breakpoint`（`schema-parity.test.ts:189-204` 对 MySQL ≥0020 强校验；PG 侧保持同风格）。**不要**写 `CHARSET` / `COLLATE`（`schema-parity.test.ts:206-214`）。

```sql
-- 多真人协作房间：房间 / 成员 / 消息。个人 chat_sessions 语义不受影响。

CREATE TABLE IF NOT EXISTS "enterprise_collab_rooms" (
  "id" varchar(26) PRIMARY KEY NOT NULL,
  "tenant_id" varchar(26) NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "title" varchar(160) NOT NULL,
  "created_by" varchar(26) NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "archived_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "enterprise_collab_rooms_tenant_updated_idx"
  ON "enterprise_collab_rooms" ("tenant_id", "updated_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "enterprise_collab_room_members" (
  "id" varchar(26) PRIMARY KEY NOT NULL,
  "room_id" varchar(26) NOT NULL REFERENCES "enterprise_collab_rooms"("id") ON DELETE CASCADE,
  "tenant_id" varchar(26) NOT NULL,
  "member_type" varchar(16) NOT NULL,
  "member_id" varchar(64) NOT NULL,
  "display_name" varchar(64) NOT NULL,
  "room_role" varchar(16) DEFAULT 'member' NOT NULL,
  "joined_at" timestamp with time zone DEFAULT now() NOT NULL,
  "left_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "enterprise_collab_room_members_room_member_uq"
  ON "enterprise_collab_room_members" ("room_id", "member_type", "member_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "enterprise_collab_room_members_lookup_idx"
  ON "enterprise_collab_room_members" ("tenant_id", "member_id", "left_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "enterprise_collab_room_messages" (
  "id" varchar(26) PRIMARY KEY NOT NULL,
  "room_id" varchar(26) NOT NULL REFERENCES "enterprise_collab_rooms"("id") ON DELETE CASCADE,
  "tenant_id" varchar(26) NOT NULL,
  "seq" bigint NOT NULL,
  "sender_type" varchar(16) NOT NULL,
  "sender_id" varchar(64) NOT NULL,
  "sender_name" varchar(64) NOT NULL,
  "content" text NOT NULL,
  "model" varchar(160),
  "metadata" jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "enterprise_collab_room_messages_room_seq_uq"
  ON "enterprise_collab_room_messages" ("room_id", "seq");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "enterprise_collab_room_messages_room_created_idx"
  ON "enterprise_collab_room_messages" ("room_id", "created_at");
```

MySQL 版（`drizzle-mysql/0023_enterprise_collab_rooms.sql`）：同样三张表，差异按既有 MySQL 迁移习惯（反引号、`timestamp` 用 `datetime(3)` 或与 `0021_enterprise_user_groups.sql` 保持一致的写法、`jsonb` → `json`、`text` → `text`）。**实施前必须打开 `drizzle-mysql/0021_enterprise_user_groups.sql` 与 `0022_enterprise_user_opt_outs.sql` 对齐语法**，不要凭记忆写。

---

## journal 追加

`drizzle/meta/_journal.json` 末尾（现最后一条是 idx 48 `0048_enterprise_user_opt_outs`）追加：

```json
{
  "idx": 49,
  "version": "7",
  "when": <取上一条 when + 100000>,
  "tag": "0049_enterprise_collab_rooms",
  "breakpoints": true
}
```

`version` 与 `when` 的写法**照抄同文件里前一条**，不要自创格式。

`drizzle-mysql/meta/_journal.json` 末尾（现最后一条是 idx 22 `0022_enterprise_user_opt_outs`，`when: 1786700000001`）追加：

```json
{
  "idx": 23,
  "version": "5",
  "when": 1786800000001,
  "tag": "0023_enterprise_collab_rooms",
  "breakpoints": true
}
```

---

## 必须更新的强断言（照此改，否则测试红）

### `src/__tests__/migration-inventory.test.ts`

| 位置 | before | after |
|---|---|---|
| L16 用例名 | `journal has exactly 48 entries...` | `journal has exactly 49 entries...` |
| L22 | `expect(journal.entries).toHaveLength(48);` | `toHaveLength(49)` |
| L23 | `[...Array(48).keys()]` | `[...Array(49).keys()]` |
| L24-28 | 末三 tag = `0046_enterprise_capability_packs` / `0047_enterprise_user_groups` / `0048_enterprise_user_opt_outs` | `0047_enterprise_user_groups` / `0048_enterprise_user_opt_outs` / `0049_enterprise_collab_rooms` |
| L31 用例名 + L35 | `disk has 50 SQL files` / `toHaveLength(50)` | `51` / `toHaveLength(51)` |

`KNOWN_ORPHANS`（L10-13）**不要动**。

### `src/__tests__/schema-parity.test.ts`

| 位置 | before | after |
|---|---|---|
| L57 用例名 + L58 | `mirrors all 56 PostgreSQL tables` / `toBe(56)` | `59` / `toBe(59)` |
| L118-142 MySQL 文件清单 | 末项 `"0022_enterprise_user_opt_outs.sql"` | 追加 `"0023_enterprise_collab_rooms.sql"` |
| L158-182 MySQL journal 期望 | 末项 idx 22 | 追加 `expect.objectContaining({ idx: 23, tag: "0023_enterprise_collab_rooms" })` |

> 56 → 59 的前提是本子 plan 恰好新增 3 张表。如果实施时表数不同，按实际数字改，并在 PR 说明里写清。

---

## AC（可执行验收）

- **AC-01-1**：`pnpm -C enterprise/packages/db-schema test` 全绿，其中 `schema-parity.test.ts` 的「mirrors all 59 PostgreSQL tables」与「keeps logical columns, nullability, and data types aligned」通过。
- **AC-01-2**：`pnpm -C enterprise typecheck` 通过。
- **AC-01-3**：`grep -rn "chat_sessions" enterprise/packages/db-schema/drizzle/0049_enterprise_collab_rooms.sql` 无输出（证明没碰个人历史表）。
- **AC-01-4**：`git diff --name-only` 的文件列表 ⊆ 上文「落点清单」的 10 个文件。
- **AC-01-5**：在已起中间件的环境执行 `pnpm -C enterprise db:migrate` 成功，且 `\d enterprise_collab_room_messages` 能看到 `enterprise_collab_room_messages_room_seq_uq`。

---

## 风险与对策

| 风险 | 对策 |
|---|---|
| 迁移编号撞车（有人同时加迁移） | 实施前 `ls enterprise/packages/db-schema/drizzle | tail -5` 确认 0048 仍是最后一个；若已被占用则顺延并同步改测试数字 |
| MySQL 语法与 PG 抄串 | 逐字对照 `drizzle-mysql/0021`、`0022` 两个已存在文件 |
| parity 测试因 `mode` 不一致失败 | `bigint` 两边都写 `{ mode: "number" }`；`jsonb` ↔ `json` 由测试的 `logicalType()` 归一（L24-31），不必特殊处理 |
| 误加 FK 到 `users(member_id)` | 明确不加：`meta`/agent 不是 users 行 |
