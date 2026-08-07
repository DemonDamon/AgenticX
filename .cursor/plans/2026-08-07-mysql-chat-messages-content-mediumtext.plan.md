# MySQL 方言下 chat_messages.content 长度上限修复

Planned-with: Opus 5
Suggested-Impl-Model: Composer 2.5 / Fast 档（纯 schema + 迁移样板改动，无逻辑设计，不需要强推理或审美）

## 背景与根因（证据链）

### 现象

客户测试环境（MySQL 方言）跑深度调研后，写聊天历史直接 500：

```
[chat-history] server error: Error: Data too long for column 'content' at row 2
  at Object.query (src/lib/chat-history/mysql.ts:49:53)
  at SqlChatHistoryStore.insertMessages (src/lib/chat-history/sql-store.ts:338:20)
  at async SqlChatHistoryStore.appendChatMessages (src/lib/chat-history/sql-store.ts:446:5)
  at async POST (src/app/api/chat/sessions/[sessionId]/messages/route.ts:88:7)
{
  code: 'ER_DATA_TOO_LONG',
  errno: 1406,
  sqlState: '22001',
  sqlMessage: "Data too long for column 'content' at row 2",
  ...
  'assistant', '<think>用户需要我编写深度研究报告的第一节...'  ... 129990 more characters
}
POST /api/chat/sessions/01KZD35Z50ZC85SP4988H4EGAN/messages 500 in 270ms
```

失败的是第 2 行（assistant 消息），正文约 13 万字符。

### 根因

MySQL 的 `TEXT` 类型上限为 65535 字节。深度调研生成的 assistant 消息（含 `<think>` 推理全文）远超该上限，插入被 MySQL 拒绝，整个事务回滚，接口返回 500。

三处证据：

1. `enterprise/packages/db-schema/src/mysql-schema/chat-messages.ts:22` 定义为 `content: text("content").notNull()`。
2. `enterprise/packages/db-schema/drizzle-mysql/0000_mysql_baseline.sql:271` 建表即为 `` `content` text NOT NULL ``，其后 0001–0013 共 13 个迁移**没有任何一个**加宽过该列。
3. 实测线上库确认（本地两个库均为 `text`，`CHARACTER_MAXIMUM_LENGTH=65535`）：

```
TABLE_SCHEMA        COLUMN_NAME  DATA_TYPE  CHARACTER_MAXIMUM_LENGTH
agenticx            content      text       65535
agenticx_hc0730     content      text       65535
```

### 为什么只在 MySQL 出现

PostgreSQL 的 `text` 无长度上限。`enterprise/packages/db-schema/src/schema/chat-messages.ts:22` 同为 `text("content")`，但 PG 侧不会触发，因此本问题**仅影响 MySQL 方言部署**。

### 为什么客户环境必然踩到

客户交付用的 compose 是硬编码 MySQL 的，不是 `test.yml` / `prod.yml` 的 `${DATABASE_DIALECT:-postgresql}` 默认值：

- `enterprise/deploy/docker-compose/portal.yml:6` → `DATABASE_DIALECT: mysql`
- `enterprise/deploy/docker-compose/gateway.yml:7` → `DATABASE_DIALECT: mysql`
- `enterprise/deploy/docker-compose/admin.yml:6` → `DATABASE_DIALECT: mysql`

建库走 `enterprise/scripts/bootstrap.sh:451` 的 `pnpm --filter @agenticx/db-schema db:migrate`，该脚本 `enterprise/packages/db-schema/scripts/db-migrate.mjs` 按 `DATABASE_DIALECT` 选择 `drizzle.mysql.config.ts`，应用 `drizzle-mysql/` 下迁移。既然没有加宽迁移，任何新建或已建的 MySQL 库，`chat_messages.content` 都停留在 64KB。

### 已有先例

同类问题此前修过一次，但漏掉了 `chat_messages`。`enterprise/packages/db-schema/drizzle-mysql/0013_chat_artifacts_content_mediumtext.sql` 已经把另外两列加宽：

```sql
ALTER TABLE `enterprise_chat_artifacts`
  MODIFY COLUMN `content` mediumtext NOT NULL;
--> statement-breakpoint
ALTER TABLE `enterprise_deep_research_runs`
  MODIFY COLUMN `report_markdown` mediumtext NOT NULL;
```

本 plan 就是把 `chat_messages.content` 补齐到同一档位（`mediumtext`，16MB）。

## In scope

- `enterprise/packages/db-schema/src/mysql-schema/chat-messages.ts` 的 `content` 列类型
- 新增一个 `drizzle-mysql/` 迁移与其 journal 条目

## Out of scope（严禁顺手改）

- **PG schema 不动**：`src/schema/chat-messages.ts` 保持 `text`，PG 无上限，改了反而制造无谓 diff。
- **不改 `0000_mysql_baseline.sql`**：drizzle 迁移是追加式的，改基线会让已应用该基线的存量库校验错乱。加宽只能靠新迁移。
- **不动 `chat-history` 读写逻辑**：`sql-store.ts` / `mysql.ts` / `messages/route.ts` 一律不改，不加截断、不加长度校验。
- **不处理「`<think>` 全文是否应该落库」**：这是独立的产品语义问题，`mediumtext` 只是把天花板抬到 16MB。如需收敛另立 plan。
- 不改其他表的任何列。

## 需求

### FR-1：MySQL schema 定义改为 mediumtext

文件：`enterprise/packages/db-schema/src/mysql-schema/chat-messages.ts`

第 2 行的 import 需要引入 `mediumtext`（`drizzle-orm/mysql-core` 已导出，`src/mysql-schema/chat-artifacts.ts:6` 和 `src/mysql-schema/deep-research-runs.ts:7` 就是这么用的）。

before（第 2 行）：

```ts
import { check, foreignKey, index, json, mysqlTable, text, varchar } from "drizzle-orm/mysql-core";
```

after：

```ts
import { check, foreignKey, index, json, mediumtext, mysqlTable, text, varchar } from "drizzle-orm/mysql-core";
```

注意 `text` 仍需保留在 import 里——本文件是否还有其他 `text()` 列，实施时以实际为准；若改完 `content` 后 `text` 不再被引用，则从 import 中移除以免 lint 报未使用。

before（第 22 行）：

```ts
    content: text("content").notNull(),
```

after：

```ts
    content: mediumtext("content").notNull(),
```

其余字段（`role` / `model` / `status` / `metadata`、两个 check 约束、三个索引、复合外键）**一律不动**。

### FR-2：新增加宽迁移

新建文件：`enterprise/packages/db-schema/drizzle-mysql/0014_chat_messages_content_mediumtext.sql`

内容：

```sql
ALTER TABLE `chat_messages`
  MODIFY COLUMN `content` mediumtext NOT NULL;
```

编号依据：`main` 分支 `drizzle-mysql/` 现有最大编号为 `0013_chat_artifacts_content_mediumtext.sql`，故新迁移为 `0014`。

### FR-3：登记 journal 条目

文件：`enterprise/packages/db-schema/drizzle-mysql/meta/_journal.json`

在 `entries` 数组末尾（当前最后一项是 `idx: 13` 的 `0013_chat_artifacts_content_mediumtext`）追加：

```json
    {
      "idx": 14,
      "version": "5",
      "when": 1785900000001,
      "tag": "0014_chat_messages_content_mediumtext",
      "breakpoints": true
    }
```

`when` 必须严格大于前一条的 `1785800000001`，沿用现有序列的递增步长（+100000000）。`tag` 必须与 SQL 文件名去掉 `.sql` 后缀完全一致，否则 drizzle-kit 找不到文件。注意追加时要给前一项补逗号，保证 JSON 合法。

## 验收标准

### AC-1：迁移能在全新 MySQL 库上跑通

```bash
cd enterprise/packages/db-schema
DATABASE_DIALECT=mysql DATABASE_URL='mysql://<user>:<pass>@127.0.0.1:3306/<fresh_db>' pnpm db:migrate
```

期望：输出 `[db:migrate] dialect=mysql config=drizzle.mysql.config.ts`，无报错退出码 0。

### AC-2：迁移能在存量库上增量应用

对一个已应用到 0013 的库重跑 `pnpm db:migrate`，期望只执行 0014，不重复执行历史迁移，退出码 0。

### AC-3：列类型确实变了

```sql
SELECT DATA_TYPE, CHARACTER_MAXIMUM_LENGTH
FROM information_schema.COLUMNS
WHERE TABLE_NAME = 'chat_messages' AND COLUMN_NAME = 'content';
```

期望：`mediumtext` / `16777215`。

### AC-4：超长正文可写入

在迁移后的库上插入一条 `content` 长度约 13 万字符的 assistant 消息，期望成功，不再抛 `ER_DATA_TOO_LONG` / errno 1406。可直接复现原始场景：跑一次深度调研，确认 `POST /api/chat/sessions/{id}/messages` 返回 200 而非 500。

### AC-5：PG 侧无回归

```bash
cd enterprise/packages/db-schema
DATABASE_DIALECT=postgresql DATABASE_URL='postgres://...' pnpm db:migrate
```

期望正常，且 `git diff` 中不包含 `src/schema/`、`drizzle/`（PG 迁移目录）下的任何改动。

### AC-6：类型检查通过

```bash
cd enterprise && pnpm typecheck
```

期望绿。重点确认 `chat-messages.ts` 的 import 改动没有留下未使用符号。

## 上线与同步注意事项

**存量客户环境**：加了迁移后，客户下次部署跑 `bootstrap.sh` 的 `db:migrate` 会自动补上，无需手工连库。若需要在不重跑部署的情况下立即解封，可临时手工执行 FR-2 里那条 `ALTER`，但这不能替代迁移文件——否则客户重建库会再次踩坑。

**MySQL DDL 代价**：`TEXT` → `MEDIUMTEXT` 属于变更列存储类型，InnoDB 走表重建（copy 算法，非 in-place），期间阻塞该表写入。客户测数据量小，秒级完成；若将来在大数据量生产库执行，需挑维护窗口或改用 gh-ost 等在线改表工具。

**同步进 `hc-0730` 时必须改编号**：`hc-0730` 分支的 `drizzle-mysql/` 已经存在 `0014_chat_artifacts_content_mediumtext.sql`（该分支多出 `0008_chat_sessions_pinned_at`、`0012_chat_share_snapshots` 等迁移，导致整体编号比 main 大 1）。把本改动合并/挑拣进 `hc-0730` 时，SQL 文件需重命名为 `0015_chat_messages_content_mediumtext.sql`，journal 条目相应改为 `idx: 15` / `tag: "0015_chat_messages_content_mediumtext"` / `when` 递增。直接合并会产生文件名与 journal 冲突，务必人工处理。
