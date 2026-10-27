# MA-E07 Memory Store 记忆库控制面（路径化条目 · 不可变版本 · CAS 写入）

Planned-with: Claude Opus 5.5
Suggested-Impl-Model: Grok 4.7
Parent: .cursor/plans/2026-10-25-managed-agents-master.plan.md（W4 · MA-E07）
Depends-on:
- MA-E01 / MA-E02 / MA-E05（已实现：`ma_sessions.resources` jsonb 列、`lib/ma/*` 写法、`getMaSession`）
- MA-E06 `.cursor/plans/pending/2026-10-25-ma-e06-vault-control-plane.plan.md`（**尚未实现**：本子规划复用它新增的 `MA_CONTROL_PLANE_ERROR_CODES` 结构、平台页插入位置与迁移编号顺序。以实际实现为准，实施前核对）
- MA-E03（**尚未实现**，迁移 0062 / 0036）
- 消费方：MA-A07 `.cursor/plans/pending/2026-10-25-ma-a07-memory-mount.plan.md`（调用本子规划的内部接口）

> 风险等级：中。
>
> **实施前核对**：`ls enterprise/packages/db-schema/drizzle | tail -3`。本子规划使用 **PG `0064_ma_memory_stores` / MySQL `0038_ma_memory_stores`**，前提是 E03（0062 / 0036）与 E06（0063 / 0037）已合入；未合入时按实际末项顺延并通知相关子规划，journal `idx` 必须连续。`schema-parity.test.ts` 表数在 E06 后为 81，本子规划改为 84。

---

## 0. 一句话目标

新增 `ma_memory_stores` / `ma_memories` / `ma_memory_versions` 三张表（双方言），每条记忆 = 路径 + ≤100 KiB 文本 + 整数 `version`（CAS）；每次创建 / 修改 / 删除生成一条**不可变**版本（含来源会话、执行主体 用户 / 智能体、可脱敏）；管理台「记忆库」页可浏览、编辑（带版本前置条件）、看版本历史、脱敏历史版本；公共接口 `/api/ma/v1/memory_stores*`（`ma:memory:read` / `ma:memory:write`）；agent-runtime 的读写经 admin-console 内部接口完成（快照读取 + 批量 CAS 写入）。

---

## 1. 根因 / 动机与证据链

### 1.1 来自 master 的约束

| master 节 | 约束 | 落点 |
|---|---|---|
| §1.2 | Memory Store 以文件挂载进沙箱；每次写入产生版本，可审计 | §4 表结构；§5.5 内部接口供 A07 挂载 |
| §2.3 | `ma_memory_stores` 唯一写入方 admin-console；`ma_memories` / `ma_memory_versions` 允许 agent-runtime 与 admin-console 双写，但必须走 `version` 列 CAS，子规划须写冲突用例 | **本子规划选择更严格的方案：agent-runtime 也经 admin-console 内部接口写入**，物理上只有 admin-console 一个写入进程；CAS 仍完整实现（并发会话之间、会话与管理员之间都会冲突）。冲突用例见 FR-6 / FR-7 |
| §7 W4 门 | 管理员能看到每次变更的版本与来源会话；另一个用户的未挂载会话读不到 | §5.6 版本历史页；§5.5 快照接口校验会话确实挂载了该库 |
| §9 MA-E07 | 新表、CAS、管理页查看 / 编辑 / 版本与来源会话 | 全文 |

### 1.2 调研语义（`research/managed-agents/`）

| 来源 | 语义 | 采纳 |
|---|---|---|
| `zhipu/memory-stores.md` L43 | Store：`name` 1–255、`description` ≤1024、`metadata` ≤16 个 string 键值 | 采纳 |
| 同上 L61 | `path` 以 `/` 开头，NFC，≤1024 UTF-8 字节，不得为裸 `/`、空段、`.`、`..`、控制字符；`content` UTF-8 默认 ≤100 KiB | 逐字采纳，另加每段 ≤255 字节（文件系统限制，A07 要落盘） |
| 同上 L110-119 | 列表 `path_prefix`、`depth`、`view=basic\|full`（full 时 limit ≤20）；更新可带 `precondition{type:"content_sha256"}`；删除可带 `expected_content_sha256` | 采纳；另提供整数 `expected_version`（A07 用） |
| 同上 L133-153 | 版本标注 `created/modified/deleted` 与主体（会话内 Agent 带 session_id / API 用户）；脱敏抹除历史版本的 path / content / sha，记录 `redacted_at/by`；不能脱敏当前 head（409） | 采纳 |
| 同上 L157-163 | 归档后不能挂到新会话、已挂载会话继续可用；删除连同记忆与版本 | 采纳；删除前须先归档且无运行中会话引用 |
| 同上 L174-176 | 冲突返回 409（路径冲突 / 前置条件失败），不应当作网络故障无限重试 | 错误码 `memory_path_conflict` / `memory_version_conflict` |
| `volcengine/persistent-memory.md` L68、L99、L135 | 只能在建会话时挂载；不可信输入下谨慎给写权限；`create` 路径已存在不覆盖 | 采纳（挂载语义在 A07） |

### 1.3 现状代码证据（2026-10-25 核对，实施前重新核对行号）

| 文件 | 行 | 事实 | 影响 |
|---|---|---|---|
| `enterprise/packages/db-schema/src/schema/ma-environments.ts`、`mysql-schema/ma-environments.ts` | 全文 | drizzle 双方言样板 | 照抄 |
| `enterprise/packages/db-schema/drizzle-mysql/0035_ma_control_plane.sql` | 1-4 | MySQL JSON 默认值写法、不写 CHARSET、`datetime(6)` | 照抄 |
| `enterprise/packages/db-schema/drizzle-mysql/0013_chat_artifacts_content_mediumtext.sql` | 全文 | 已有把内容列改为 `mediumtext` 的先例（MySQL `text` 上限 65535 字节） | 记忆内容 100 KiB → MySQL 用 `mediumtext` |
| `enterprise/packages/db-schema/src/__tests__/schema-parity.test.ts` | 24-31、57-58 | 逻辑类型比较（`mediumtext` 与 `text` 的 drizzle `dataType` 都是 `string`）；PG 表数断言 | `content` 列 PG `text` / MySQL `mediumtext` 可通过 parity |
| `enterprise/apps/admin-console/src/lib/ma/errors.ts` | 6-11、46-87 | `MA_CONTROL_PLANE_ERROR_CODES` + `maErrorFromException` | 追加 8 个码 |
| `enterprise/apps/admin-console/src/lib/ma/{pat-auth,internal-auth,http}.ts` | — | 公共 / 内部接口鉴权与请求解析 | 沿用 |
| `enterprise/packages/iam-core/src/repos/ma-sessions-read.ts` | 37-39、298 | `getMaSession` 返回 `resources: Record<string, unknown>[]`、`status` | 内部接口校验会话挂载关系与访问模式 |
| `enterprise/packages/iam-core/src/repos/ma-environments.ts` | 1-140 | repo 样板（`isMysql`、`isUniqueViolation`、具名错误） | 照抄 |
| `enterprise/packages/iam-core/src/repos/audit.ts` | 34-36 | `insertAuditEvent` | Store 级创建 / 归档 / 删除 / 脱敏写 `audit_events`；条目级变更由 `ma_memory_versions` 本身承担审计 |
| `enterprise/apps/admin-console/src/app/api/admin/ma-environments/route.ts` | 14-50 | 管理台接口样板 | 照抄；权限复用 `kb:read` / `kb:update` / `kb:delete`（§2 D7） |
| `enterprise/apps/admin-console/src/lib/admin-platform-sections.ts`、`[section]/page.tsx`、`AppShell.tsx` | 见 E06 §1.3 | 平台页注册三处 | 在 `"agent-vaults"` 之后插入 `"agent-memory"`（E06 未合入时插在 `"agent-environments"` 之后） |

---

## 2. 关键设计决策

| # | 决策 | 理由 |
|---|---|---|
| D1 | **单一物理写入方**：agent-runtime 不直连记忆表，经 `POST /api/internal/ma/memory-stores/:id/writes` 写入；admin-console 内部按 CAS 执行 | master §2.3 允许双写但不强制；收敛到一个进程省掉 Python 侧表映射与 parity 测试，CAS 语义不变 |
| D2 | **版本号语义**：`ma_memories.version` 创建时为 1，每次修改 +1；删除写一条 `operation='deleted'`、`version = 原 version + 1` 的版本并删除 `ma_memories` 行；同一路径删除后再创建得到**新的** `memory_id`、从 1 开始 | 简单、与 CAS 天然对应；删除后历史仍可按 `memory_id` 查 |
| D3 | **CAS 实现**：更新 / 删除用 `UPDATE ... WHERE id = ? AND store_id = ? AND version = ?`（删除先 `SELECT ... FOR UPDATE` 再判版本），影响行数 0 → `memory_version_conflict`，响应带当前 head；创建依赖唯一索引 `(store_id, path_hash)`，冲突 → `memory_path_conflict` | 不加锁表，数据库保证原子 |
| D4 | **路径唯一用 `path_hash`**（sha256 hex of NFC path）+ 唯一索引；`path` 原文另存 | MySQL utf8mb4 `varchar(1024)` 超 3072 字节索引上限 |
| D5 | **文件 / 目录前缀冲突**：创建或改名到 `/a/b` 时若已有 `/a`，或创建 `/a` 时已有任何 `/a/...`，返回 `memory_path_conflict`。实现：事务内读取该 store 全部 path（上限 2000 条）在应用层判断 | A07 要把记忆落成文件，`/a` 既是文件又是目录无法落盘 |
| D6 | **限额**：每 store ≤2000 条记忆、内容总量 ≤20 MiB、单条 ≤100 KiB（102400 字节，UTF-8）；超限 409 `memory_store_limit` | 挂载时整库落盘，需要上界 |
| D7 | **管理台权限复用 `kb:read` / `kb:update` / `kb:delete`** | 记忆属于知识类资产；不改 `SCOPE_REGISTRY` |
| D8 | **脱敏**：仅限非 head 版本（head = 该 `memory_id` 当前行对应版本；已删除记忆的「deleted」版本也算 head，不能脱敏）；把 `path` / `path_hash` / `content` / `content_sha256` / `size_bytes` 置 NULL，`redacted=true`、`redacted_at/by` | 与调研一致 |
| D9 | **内部写接口非原子批**：每个 op 独立事务、逐条返回结果 | A07 的冲突处理是逐文件的；一个文件冲突不应回滚其他文件 |
| D10 | **会话访问校验**：内部快照 / 写接口要求会话存在、未归档 / 终止、`resources` 中有 `{type:"memory_store", memory_store_id}` 指向该库；写接口还要求该项 `access == "read_write"` | 纵深防御，W4 门「未挂载的会话读不到」 |

---

## 3. In scope / Out of scope

### 3.1 In scope（只能创建或修改这些文件）

db-schema：
- 新建 `enterprise/packages/db-schema/drizzle/0064_ma_memory_stores.sql`、`drizzle-mysql/0038_ma_memory_stores.sql`
- 修改两个 `meta/_journal.json`（各追加 1 条）
- 新建 `src/schema/ma-memory.ts`、`src/mysql-schema/ma-memory.ts`；修改两个 `index.ts`（`export * from "./ma-memory";` 放在 `./ma-vaults` 之后，E06 未合入则放 `./ma-environments` 之后）
- 修改 `src/__tests__/migration-inventory.test.ts`、`schema-parity.test.ts`、`ma-schema.test.ts`

iam-core：
- 新建 `src/repos/ma-memory-path.ts`（纯函数）、`src/repos/ma-memory.ts`、`src/repos/mysql/ma-memory.ts`
- 修改 `src/index.ts`（追加 2 行 export）
- 新建 `src/repos/__tests__/ma-memory-path.test.ts`、`src/repos/__tests__/ma-memory-cas.test.ts`

admin-console：
- 修改 `src/lib/ma/errors.ts`
- 新建 `src/lib/ma/memory-records.ts`
- 新建公共接口（相对 `src/app/api/ma/v1/`）：`memory_stores/route.ts`、`memory_stores/[storeId]/route.ts`、`memory_stores/[storeId]/archive/route.ts`、`memory_stores/[storeId]/memories/route.ts`、`memory_stores/[storeId]/memories/[memoryId]/route.ts`、`memory_stores/[storeId]/memory_versions/route.ts`、`memory_stores/[storeId]/memory_versions/[versionId]/route.ts`、`memory_stores/[storeId]/memory_versions/[versionId]/redact/route.ts`
- 新建内部接口（相对 `src/app/api/internal/ma/`）：`memory-stores/validate/route.ts`、`memory-stores/[storeId]/snapshot/route.ts`、`memory-stores/[storeId]/writes/route.ts`
- 新建管理台接口（相对 `src/app/api/admin/ma-memory-stores/`）：`route.ts`、`shared.ts`、`[storeId]/route.ts`、`[storeId]/archive/route.ts`、`[storeId]/memories/route.ts`、`[storeId]/memories/[memoryId]/route.ts`、`[storeId]/versions/route.ts`、`[storeId]/versions/[versionId]/redact/route.ts`
- 新建页面 `src/app/admin/_sections/agent-memory.tsx`
- 修改 `src/app/admin/[section]/page.tsx`、`src/lib/admin-platform-sections.ts` 与其测试、`src/components/AppShell.tsx`、`messages/zh.json`、`messages/en.json`
- 新建测试 `src/app/api/ma/v1/__tests__/memory-stores-route.test.ts`、`src/app/api/internal/ma/__tests__/memory-internal-routes.test.ts`、`src/app/api/admin/ma-memory-stores/__tests__/route.test.ts`

文档：
- 修改 `docs/managed-agents/protocol.md`（文末追加「Memory Store 控制面」一节）

### 3.2 Out of scope

- `agenticx/**`、`enterprise/apps/agent-runtime/**`（挂载属 MA-A07）、`gateway`、`web-portal`、`desktop`、`core-api`。
- 记忆的向量检索 / 语义搜索、记忆整理（MA-A10）、按用户可见范围、跨租户共享、导入导出。
- `agenticx/memory/workspace_memory.py` 与个人模式记忆。

---

## 4. 数据结构

### 4.1 PG `0064_ma_memory_stores.sql`（逐字）

```sql
-- Managed Agents 记忆库。唯一物理写入方：admin-console（agent-runtime 经 /api/internal/ma/memory-stores/* 写入）。
-- ma_memories.version 是 CAS 版本号；每次变更追加一条不可变 ma_memory_versions。
-- path_hash = sha256(NFC path) hex，用于唯一约束（MySQL 无法对 varchar(1024) 建唯一索引）。
CREATE TABLE IF NOT EXISTS "ma_memory_stores" (
  "id" varchar(26) PRIMARY KEY NOT NULL,
  "tenant_id" varchar(26) NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "name" varchar(255) NOT NULL,
  "description" varchar(1024),
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "status" varchar(16) DEFAULT 'active' NOT NULL,
  "created_by" varchar(26),
  "archived_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ma_memory_stores_tenant_status_idx"
  ON "ma_memory_stores" ("tenant_id", "status", "created_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ma_memories" (
  "id" varchar(26) PRIMARY KEY NOT NULL,
  "tenant_id" varchar(26) NOT NULL,
  "store_id" varchar(26) NOT NULL REFERENCES "ma_memory_stores"("id") ON DELETE CASCADE,
  "path" varchar(1024) NOT NULL,
  "path_hash" varchar(64) NOT NULL,
  "content" text NOT NULL,
  "content_sha256" varchar(64) NOT NULL,
  "size_bytes" integer NOT NULL,
  "version" integer DEFAULT 1 NOT NULL,
  "last_actor_kind" varchar(16) NOT NULL,
  "last_actor_user_id" varchar(26),
  "last_session_id" varchar(26),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ma_memories_store_path_uq"
  ON "ma_memories" ("store_id", "path_hash");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ma_memories_tenant_store_idx"
  ON "ma_memories" ("tenant_id", "store_id", "updated_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ma_memory_versions" (
  "id" varchar(26) PRIMARY KEY NOT NULL,
  "tenant_id" varchar(26) NOT NULL,
  "store_id" varchar(26) NOT NULL REFERENCES "ma_memory_stores"("id") ON DELETE CASCADE,
  "memory_id" varchar(26) NOT NULL,
  "version" integer NOT NULL,
  "operation" varchar(16) NOT NULL,
  "path" varchar(1024),
  "path_hash" varchar(64),
  "content" text,
  "content_sha256" varchar(64),
  "size_bytes" integer,
  "actor_kind" varchar(16) NOT NULL,
  "actor_user_id" varchar(26),
  "source_session_id" varchar(26),
  "redacted" boolean DEFAULT false NOT NULL,
  "redacted_at" timestamp with time zone,
  "redacted_by" varchar(26),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ma_memory_versions_memory_version_uq"
  ON "ma_memory_versions" ("memory_id", "version");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ma_memory_versions_store_time_idx"
  ON "ma_memory_versions" ("store_id", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ma_memory_versions_tenant_session_idx"
  ON "ma_memory_versions" ("tenant_id", "source_session_id");
```

`ma_memory_versions.memory_id` **不加外键**：删除记忆行后版本必须保留。

### 4.2 MySQL `0038_ma_memory_stores.sql`（逐字）

```sql
-- Managed Agents 记忆库（MySQL）。content 用 mediumtext（text 上限 65535 字节 < 100 KiB）。
CREATE TABLE IF NOT EXISTS `ma_memory_stores` (
  `id` varchar(26) NOT NULL,
  `tenant_id` varchar(26) NOT NULL,
  `name` varchar(255) NOT NULL,
  `description` varchar(1024),
  `metadata` json NOT NULL DEFAULT (JSON_OBJECT()),
  `status` varchar(16) NOT NULL DEFAULT 'active',
  `created_by` varchar(26),
  `archived_at` datetime(6),
  `created_at` datetime(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
  `updated_at` datetime(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
  CONSTRAINT `ma_memory_stores_id` PRIMARY KEY (`id`),
  CONSTRAINT `ma_memory_stores_tenant_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`) ON DELETE CASCADE,
  INDEX `ma_memory_stores_tenant_status_idx` (`tenant_id`, `status`, `created_at`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `ma_memories` (
  `id` varchar(26) NOT NULL,
  `tenant_id` varchar(26) NOT NULL,
  `store_id` varchar(26) NOT NULL,
  `path` varchar(1024) NOT NULL,
  `path_hash` varchar(64) NOT NULL,
  `content` mediumtext NOT NULL,
  `content_sha256` varchar(64) NOT NULL,
  `size_bytes` int NOT NULL,
  `version` int NOT NULL DEFAULT 1,
  `last_actor_kind` varchar(16) NOT NULL,
  `last_actor_user_id` varchar(26),
  `last_session_id` varchar(26),
  `created_at` datetime(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
  `updated_at` datetime(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
  CONSTRAINT `ma_memories_id` PRIMARY KEY (`id`),
  CONSTRAINT `ma_memories_store_fk` FOREIGN KEY (`store_id`) REFERENCES `ma_memory_stores` (`id`) ON DELETE CASCADE,
  CONSTRAINT `ma_memories_store_path_uq` UNIQUE (`store_id`, `path_hash`),
  INDEX `ma_memories_tenant_store_idx` (`tenant_id`, `store_id`, `updated_at`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `ma_memory_versions` (
  `id` varchar(26) NOT NULL,
  `tenant_id` varchar(26) NOT NULL,
  `store_id` varchar(26) NOT NULL,
  `memory_id` varchar(26) NOT NULL,
  `version` int NOT NULL,
  `operation` varchar(16) NOT NULL,
  `path` varchar(1024),
  `path_hash` varchar(64),
  `content` mediumtext,
  `content_sha256` varchar(64),
  `size_bytes` int,
  `actor_kind` varchar(16) NOT NULL,
  `actor_user_id` varchar(26),
  `source_session_id` varchar(26),
  `redacted` boolean NOT NULL DEFAULT false,
  `redacted_at` datetime(6),
  `redacted_by` varchar(26),
  `created_at` datetime(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
  CONSTRAINT `ma_memory_versions_id` PRIMARY KEY (`id`),
  CONSTRAINT `ma_memory_versions_store_fk` FOREIGN KEY (`store_id`) REFERENCES `ma_memory_stores` (`id`) ON DELETE CASCADE,
  CONSTRAINT `ma_memory_versions_memory_version_uq` UNIQUE (`memory_id`, `version`),
  INDEX `ma_memory_versions_store_time_idx` (`store_id`, `created_at`),
  INDEX `ma_memory_versions_tenant_session_idx` (`tenant_id`, `source_session_id`)
);
```

Journal：PG `{"idx": 63, "version": "7", "when": 1788200000000, "tag": "0064_ma_memory_stores", "breakpoints": true}`；MySQL `{"idx": 38, "version": "5", "when": 1788200000001, "tag": "0038_ma_memory_stores", "breakpoints": true}`（`idx` 以实际末项 +1 为准）。

### 4.3 drizzle schema

`src/schema/ma-memory.ts` 导出 `maMemoryStores`、`maMemories`、`maMemoryVersions` 及 `$inferSelect` 类型，列与索引逐一对应 §4.1（`ulid()`、`auditColumns` 用于 stores 与 memories 的 `created_at/updated_at`；versions 只有 `createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull()`）。MySQL 版 `content` 用 `mediumtext("content")`（`import { mediumtext } from "drizzle-orm/mysql-core"`），`boolean("redacted").notNull().default(false)`，`int(...)`，`datetime(..., { fsp: 6 })`。文件头注释写明「唯一物理写入方 admin-console；versions 不可更新（脱敏除外）」。

`ma-schema.test.ts` 的 `MA_COLUMNS` 追加三表列名（stores 10 列、memories 14 列、versions 18 列），并断言 `ma_memories.content` 与 `ma_memory_versions.content` 在 MySQL schema 的 `columnType` 为 `MySqlMediumText`（若 drizzle 类名不同以实际为准）。

---

## 5. 精确落点

### 5.1 `iam-core/src/repos/ma-memory-path.ts`（纯函数，与 A07 Python `validate_memory_path` 逐字同义）

```ts
export const MEMORY_PATH_MAX_BYTES = 1024;
export const MEMORY_SEGMENT_MAX_BYTES = 255;
export const MEMORY_CONTENT_MAX_BYTES = 102400;
export const MEMORY_STORE_MAX_ITEMS = 2000;
export const MEMORY_STORE_MAX_BYTES = 20 * 1024 * 1024;

export class MaMemoryValidationError extends Error { name = "MaMemoryValidationError"; }

/** Returns the NFC-normalized path or throws MaMemoryValidationError("path: <reason>"). */
export function normalizeMemoryPath(raw: unknown): string;
export function memoryPathHash(path: string): string;            // sha256(utf8(path)).hex
export function contentSha256(content: string): string;           // sha256(utf8(content)).hex
export function validateMemoryContent(raw: unknown): { content: string; sizeBytes: number; sha256: string };
export function pathConflicts(candidate: string, existing: Iterable<string>, ignorePath?: string): string | null;
```

`normalizeMemoryPath` 规则（顺序执行，任一失败抛错，消息用括号内文本）：
1. 必须是 string（`path: must be a string`）。
2. `p = raw.normalize("NFC")`。
3. 以 `/` 开头（`path: must start with "/"`）；`p === "/"` 拒绝（`path: must not be the root`）；以 `/` 结尾拒绝（`path: must not end with "/"`）。
4. `Buffer.byteLength(p, "utf8") <= 1024`（`path: exceeds 1024 bytes`）。
5. 不含 `\u0000-\u001f`、`\u007f`、`\\`（`path: contains control characters or backslash`）。
6. `segments = p.slice(1).split("/")`：任一段为空、`.`、`..` → `path: empty, "." or ".." segment`；任一段 UTF-8 字节 >255 → `path: segment exceeds 255 bytes`。
7. 返回 `p`。

`validateMemoryContent`：必须是 string（`content: must be a string`）；不含 `\u0000`（`content: must not contain NUL`）；`sizeBytes = Buffer.byteLength(content, "utf8") <= 102400`（`content: exceeds 100 KiB`）。

`pathConflicts(candidate, existing, ignorePath)`：对 `existing` 中每个 `e`（跳过 `e === ignorePath`）：`e === candidate` → 返回 `e`（重复路径由唯一索引兜底，这里也报）；`candidate.startsWith(e + "/")` 或 `e.startsWith(candidate + "/")` → 返回 `e`；无冲突返回 null。

### 5.2 `iam-core/src/repos/ma-memory.ts`

```ts
export type MaMemoryStoreStatus = "active" | "archived";
export type MaMemoryStore = { id; tenantId; name; description: string | null; metadata: Record<string,string>;
  status: MaMemoryStoreStatus; memoryCount: number; totalBytes: number; createdBy: string | null;
  archivedAt: string | null; createdAt: string; updatedAt: string };
export type MaMemory = { id; tenantId; storeId; path; contentSha256; sizeBytes; version: number;
  lastActorKind: "user" | "agent"; lastActorUserId: string | null; lastSessionId: string | null;
  createdAt: string; updatedAt: string; content?: string };      // content only when requested
export type MaMemoryVersion = { id; storeId; memoryId; version: number; operation: "created" | "modified" | "deleted";
  path: string | null; contentSha256: string | null; sizeBytes: number | null; content?: string | null;
  actorKind: "user" | "agent"; actorUserId: string | null; sourceSessionId: string | null;
  redacted: boolean; redactedAt: string | null; redactedBy: string | null; createdAt: string };
export type MemoryActor = { kind: "user"; userId: string | null } | { kind: "agent"; userId: string | null; sessionId: string };
export type MemoryWriteOp =
  | { op: "create"; path: string; content: string }
  | { op: "update"; memoryId: string; expectedVersion: number; path?: string; content?: string }
  | { op: "delete"; memoryId: string; expectedVersion: number };
export type MemoryWriteResult =
  | { ok: true; memory: MaMemory | null; version: number }        // memory null for delete
  | { ok: false; code: "memory_version_conflict" | "memory_path_conflict" | "memory_not_found" | "memory_store_limit" | "invalid_request";
      message: string; current: { id: string; path: string; version: number; contentSha256: string } | null };

export class MaMemoryStoreNotFoundError extends Error { name = "MaMemoryStoreNotFoundError"; }
export class MaMemoryNotFoundError extends Error { name = "MaMemoryNotFoundError"; }
export class MaMemoryVersionConflictError extends Error { name = "MaMemoryVersionConflictError"; current: ...; }
export class MaMemoryPathConflictError extends Error { name = "MaMemoryPathConflictError"; conflictingPath: string; }
export class MaMemoryStoreArchivedError extends Error { name = "MaMemoryStoreArchivedError"; }
export class MaMemoryStoreNotArchivedError extends Error { name = "MaMemoryStoreNotArchivedError"; }
export class MaMemoryStoreInUseError extends Error { name = "MaMemoryStoreInUseError"; }
export class MaMemoryVersionIsHeadError extends Error { name = "MaMemoryVersionIsHeadError"; }
export class MaMemoryStoreLimitError extends Error { name = "MaMemoryStoreLimitError"; }

export async function listMemoryStores(tenantId, opts?: { includeArchived?: boolean }): Promise<MaMemoryStore[]>;
export async function getMemoryStore(tenantId, storeId): Promise<MaMemoryStore>;
export async function createMemoryStore(tenantId, input, actorUserId): Promise<MaMemoryStore>;
export async function updateMemoryStore(tenantId, storeId, patch, actorUserId): Promise<MaMemoryStore>;
export async function archiveMemoryStore(tenantId, storeId, actorUserId): Promise<MaMemoryStore>;
export async function deleteMemoryStore(tenantId, storeId, actorUserId): Promise<void>;
export async function listMemories(tenantId, storeId, opts: { pathPrefix?: string; depth?: number; view: "basic" | "full"; limit: number; cursor?: string }): Promise<{ items: Array<{ kind: "memory"; memory: MaMemory } | { kind: "memory_prefix"; path: string }>; nextCursor: string | null }>;
export async function getMemory(tenantId, storeId, memoryId): Promise<MaMemory>;      // includes content
export async function applyMemoryWrite(tenantId, storeId, op: MemoryWriteOp, actor: MemoryActor): Promise<MemoryWriteResult>;
export async function listMemoryVersions(tenantId, storeId, opts: { memoryId?: string; limit: number; cursor?: string }): Promise<{ items: MaMemoryVersion[]; nextCursor: string | null }>;
export async function getMemoryVersion(tenantId, storeId, versionId): Promise<MaMemoryVersion>;   // includes content
export async function redactMemoryVersion(tenantId, storeId, versionId, actorUserId): Promise<MaMemoryVersion>;
export async function snapshotMemoryStore(tenantId, storeId): Promise<{ store: MaMemoryStore; memories: MaMemory[] }>;  // with content
export async function validateMemoryStoreIds(tenantId, ids: string[]): Promise<Array<{ id: string; status: "active" | "archived" | "missing"; name: string | null }>>;
```

行为：

1. 所有查询带 `tenant_id`；非 ULID id → NotFound。
2. Store 字段校验：`name` 必填 trim 1–255、不含控制字符与 Unicode 格式字符（`/\p{Cc}|\p{Cf}/u`）；`description` null 或 ≤1024；`metadata` 同 E06 Vault 规则（≤16 键，值 string ≤512）。抛 `MaMemoryValidationError`。
3. `createMemoryStore` / `updateMemoryStore` / `archiveMemoryStore` / `deleteMemoryStore` / `redactMemoryVersion` 各写一条 `audit_events`：`ma.memory_store.create/update/archive/delete`、`ma.memory_version.redact`，`target_kind` `ma_memory_store` / `ma_memory_version`。
4. `archiveMemoryStore`：已归档幂等；否则 `status='archived', archived_at=now`（记忆与版本保留；已挂载的会话继续可读写，新会话不能挂载）。
5. `deleteMemoryStore`：非 archived → `MaMemoryStoreNotArchivedError`；存在 `ma_sessions` 行满足 `tenant_id = ? AND status IN ('running','rescheduling')` 且 `resources` 中有 `memory_store_id = storeId`（PG：`resources @> jsonb_build_array(jsonb_build_object('memory_store_id', ?::text))`；MySQL：`JSON_CONTAINS(resources, JSON_OBJECT('memory_store_id', ?))`）→ `MaMemoryStoreInUseError`；否则删除（级联）。
6. `applyMemoryWrite`（核心，单事务）：
   - store 不存在 → `{ok:false, code:"memory_not_found"}`（批量接口逐条返回，不抛）；store archived **且 actor 为 user** → 抛 `MaMemoryStoreArchivedError`（管理员不能改已归档库；agent 写入允许，见第 4 条）。
   - `create`：`path = normalizeMemoryPath`、`validateMemoryContent`；读取该 store 全部 `(path, size_bytes)`；`count + 1 > 2000` 或 `total + size > 20 MiB` → `memory_store_limit`；`pathConflicts` → `memory_path_conflict`（`current` 为冲突路径所在记忆）；插入 `ma_memories`（version 1）与版本（`operation='created'`、version 1、path / content / sha / size、actor）；唯一冲突兜底 → `memory_path_conflict`（`current` 查出该路径的记忆）。
   - `update`：`SELECT ... WHERE id = ? AND store_id = ? FOR UPDATE`（MySQL / PG 都支持）；不存在 → `memory_not_found`；`version !== expectedVersion` → `memory_version_conflict`（`current = {id, path, version, contentSha256}`）；新 path（若给）`normalizeMemoryPath` + `pathConflicts(newPath, allPaths, oldPath)`；新 content（若给）校验 + 总量限额（减旧加新）；两者都没给 → `invalid_request`；内容与路径都未变化 → 视为成功、不写版本、返回当前 memory；否则 `UPDATE ... SET ..., version = version + 1 WHERE id = ? AND version = ?`（rowcount 0 → `memory_version_conflict`），插入版本 `operation='modified'`。
   - `delete`：同样锁行比版本；插入版本 `operation='deleted'`、`version = old + 1`、path / path_hash 保留、content / sha / size 为 NULL；删除 `ma_memories` 行。
   - actor 写入：`user` → `last_actor_kind='user'`、`last_actor_user_id`、`last_session_id=NULL`；版本 `actor_kind='user'`、`source_session_id=NULL`。`agent` → `last_actor_kind='agent'`、`last_actor_user_id = actor.userId`（会话用户，可空）、`last_session_id = actor.sessionId`；版本 `actor_kind='agent'`、`source_session_id = actor.sessionId`。
7. `listMemories`：`pathPrefix` 缺省 `/`，必须以 `/` 结尾（否则 `MaMemoryValidationError("path_prefix: must end with \"/\"")`）；`depth`（0–1024，缺省不限）：按前缀之后的段数 ≤ depth 的直接返回 memory，更深的折叠为 `memory_prefix`（前缀 + 下一段 + `/`，去重）；`view=full` 时 `limit ≤ 20`，`basic` 时 ≤ 200；排序按 `path` 升序；游标 = 最后一条的 path（base64url）。数据量上限 2000 条，应用层过滤即可。
8. `redactMemoryVersion`：版本不存在 → NotFound；已脱敏 → 幂等返回；head 判定：存在 `ma_memories` 行 `id = memory_id AND version = 该版本 version`，或该版本 `operation='deleted'` 且是该 `memory_id` 的最大版本 → `MaMemoryVersionIsHeadError`；否则把 `path/path_hash/content/content_sha256/size_bytes` 置 NULL、`redacted=true, redacted_at=now, redacted_by=actorUserId`。
9. `snapshotMemoryStore`：返回 store 与全部 memories（含 content，按 path 升序）。

### 5.3 错误码（admin-console `src/lib/ma/errors.ts`）

`MA_CONTROL_PLANE_ERROR_CODES` 追加：

```ts
  memory_store_not_found: 404,
  memory_not_found: 404,
  memory_version_conflict: 409,
  memory_path_conflict: 409,
  memory_store_archived: 409,
  memory_store_not_archived: 409,
  memory_store_in_use: 409,
  memory_version_is_head: 409,
  memory_store_limit: 409,
```

（共 9 个。）`maErrorFromException` 追加映射：`MaMemoryValidationError` → `invalid_request`（消息原样）；其余 Error 类名一一映射到同名码，消息：`"memory store not found"`、`"memory not found"`、`"memory has been modified"`（details `{current: {id, path, version, content_sha256}}`）、`"path conflicts with an existing memory"`（details `{conflicting_path}`）、`"memory store is archived"`、`"archive the memory store before deleting it"`、`"memory store is mounted by running sessions"`、`"cannot redact the current version"`、`"memory store limit reached (2000 memories / 20 MiB)"`。

### 5.4 公共接口 `/api/ma/v1/memory_stores*`

鉴权 `requireMaPat`；读 `ma:memory:read`、写 `ma:memory:write`；`noStore`；actor = `{kind:"user", userId: identity.userId}`。

| 方法 | 路径 | scope | 请求 | 响应 |
|---|---|---|---|---|
| GET | `/memory_stores?include_archived=true` | read | — | 200 `{"data":[MemoryStoreRecord]}` |
| POST | `/memory_stores` | write | `{name, description?, metadata?}` | 201 `{"memory_store"}` |
| GET / PATCH | `/memory_stores/:storeId` | read / write | PATCH `{name?, description?, metadata?}` | 200 `{"memory_store"}` |
| POST | `/memory_stores/:storeId/archive` | write | — | 200 `{"memory_store"}` |
| DELETE | `/memory_stores/:storeId` | write | — | 200 `{"id","deleted":true}` |
| GET | `/memory_stores/:storeId/memories?path_prefix=/&depth=&view=basic\|full&limit=&cursor=` | read | — | 200 `{"data":[{"type":"memory", ...MemoryRecord} \| {"type":"memory_prefix","path":"/a/"}],"next_cursor":null}` |
| POST | `/memory_stores/:storeId/memories` | write | `{path, content}` | 201 `{"memory": MemoryRecord(含 content)}`；冲突 409 |
| GET | `/memory_stores/:storeId/memories/:memoryId` | read | — | 200 `{"memory"}`（含 content） |
| PATCH | `/memory_stores/:storeId/memories/:memoryId` | write | `{path?, content?, expected_version?: int, precondition?: {type:"content_sha256", content_sha256}}`（二者至少一个） | 200 `{"memory"}`；409 带 `details.current` |
| DELETE | `/memory_stores/:storeId/memories/:memoryId?expected_version=3` 或 `?expected_content_sha256=` | write | — | 200 `{"id","deleted":true,"version":4}` |
| GET | `/memory_stores/:storeId/memory_versions?memory_id=&limit=&cursor=` | read | — | 200 `{"data":[MemoryVersionRecord(不含 content)],"next_cursor"}` |
| GET | `/memory_stores/:storeId/memory_versions/:versionId` | read | — | 200 `{"memory_version"}`（含 content） |
| POST | `/memory_stores/:storeId/memory_versions/:versionId/redact` | write | — | 200 `{"memory_version"}` |

`precondition` 处理：路由先 `getMemory` 取当前 `contentSha256` 与 `version`；sha 不同 → 409 `memory_version_conflict`；相同 → 以当前 `version` 作为 `expectedVersion` 调 `applyMemoryWrite`（仍由数据库 CAS 兜底）。两者都缺 → 400 `"expected_version or precondition is required"`。

`src/lib/ma/memory-records.ts`：

```ts
export type MemoryStoreRecord = { id; tenant_id; name; description: string | null; metadata: Record<string,string>;
  status: "active" | "archived"; memory_count: number; total_bytes: number; created_at; updated_at; archived_at: string | null };
export type MemoryRecord = { id; memory_store_id; path; content_sha256; size_bytes; version: number;
  last_actor: { type: "user"; user_id: string | null } | { type: "agent"; user_id: string | null; session_id: string };
  created_at; updated_at; content?: string };
export type MemoryVersionRecord = { id; memory_store_id; memory_id; version: number; operation: "created" | "modified" | "deleted";
  path: string | null; content_sha256: string | null; size_bytes: number | null;
  actor: { type: "user_actor"; user_id: string | null } | { type: "session_actor"; user_id: string | null; session_id: string };
  redacted: boolean; redacted_at: string | null; redacted_by: string | null; created_at: string; content?: string | null };
```

### 5.5 内部接口（agent-runtime 专用，`MA_INTERNAL_TOKEN`）

开关 `MA_MEMORY_INTERNAL_ENABLED`（默认 `"1"`，`"0"` → 三个接口 503 `{"error":{"code":"internal_error","message":"memory service is disabled"}}`——用 `NextResponse.json(..., {status: 503})` 直接返回，不新增码）。

会话访问校验（快照与写入共用的本地函数 `requireMountedSession(tenantId, sessionId, storeId, need: "read" | "write")`）：
- `getMaSession` null → 404 `session_not_found`；`status ∈ {archived, terminated}` 或 `archivedAt` 非空 → 409 `session_terminated`。
- 在 `session.resources` 中找 `type === "memory_store" && memory_store_id === storeId` 的项；找不到 → 403 `forbidden_scope`（`"session does not mount this memory store"`）。
- `need === "write"` 且该项 `access !== "read_write"` → 403 `forbidden_scope`（`"memory store is mounted read_only"`）。

#### 5.5.1 `POST /api/internal/ma/memory-stores/validate`

请求 `{"tenant_id","memory_store_ids":[...]}`（1–8 个 string）→ 200 `{"memory_stores":[{"id","status":"active"|"archived"|"missing","name":string|null}]}`（原序）。

#### 5.5.2 `GET /api/internal/ma/memory-stores/:storeId/snapshot?tenant_id=&session_id=`

`requireMountedSession(..., "read")`；store 不存在 → 404 `memory_store_not_found`（已归档仍可读）。响应：

```json
{
  "memory_store": { "id": "01J...", "name": "项目知识", "status": "active" },
  "memories": [
    { "id": "01J...", "path": "/preferences/report.md", "content": "...", "content_sha256": "ab12...", "size_bytes": 120, "version": 3 }
  ]
}
```

#### 5.5.3 `POST /api/internal/ma/memory-stores/:storeId/writes`

请求：

```json
{
  "tenant_id": "T", "session_id": "01J...",
  "ops": [
    { "op": "create", "path": "/notes/a.md", "content": "..." },
    { "op": "update", "memory_id": "01J...", "expected_version": 3, "content": "..." },
    { "op": "delete", "memory_id": "01J...", "expected_version": 2 }
  ]
}
```

- `ops` 1–50 条；每条字段严格校验（未知键 → 该条 `invalid_request`，不影响其他条）；`requireMountedSession(..., "write")` 不通过 → 整体 403。
- 逐条 `applyMemoryWrite(tenant, storeId, op, {kind:"agent", userId: session.createdByUserId, sessionId})`。
- 响应 200：

```json
{
  "results": [
    { "index": 0, "ok": true, "memory": { "id": "01J...", "path": "/notes/a.md", "version": 1, "content_sha256": "..." } },
    { "index": 1, "ok": false, "code": "memory_version_conflict", "message": "memory has been modified",
      "current": { "id": "01J...", "path": "/notes/b.md", "version": 4, "content_sha256": "..." } },
    { "index": 2, "ok": true, "memory": null, "deleted_version": 3 }
  ]
}
```

### 5.6 管理台接口与页面「记忆库」

管理台接口 `/api/admin/ma-memory-stores/*` 与公共接口一一对应（读 `["kb:read"]`、改 `["kb:update"]`、删除与脱敏 `["kb:delete"]`），响应 `{code:"00000", message:"ok", data}`，中文错误消息：

| error | message |
|---|---|
| `MaMemoryVersionConflictError` | 该记忆已被其他会话或管理员修改，请刷新后再编辑 |
| `MaMemoryPathConflictError` | 路径与已有记忆冲突（同名或文件 / 目录冲突） |
| `MaMemoryStoreArchivedError` | 记忆库已归档，不能再修改 |
| `MaMemoryStoreNotArchivedError` | 请先归档记忆库再删除 |
| `MaMemoryStoreInUseError` | 仍有运行中的会话挂载了该记忆库，请稍后再删除 |
| `MaMemoryVersionIsHeadError` | 不能脱敏当前版本，请先修改或删除该记忆 |
| `MaMemoryStoreLimitError` | 记忆库已达上限（2000 条 / 20 MiB） |

页面 `src/app/admin/_sections/agent-memory.tsx`（客户端组件，样式参照 `agent-environments.tsx`）：
- **列表**：列「名称、描述、记忆条数、占用大小、状态、更新时间、操作」；「新建记忆库」；「显示已归档」。空态文案：「还没有记忆库。记忆库让智能体跨会话保留偏好与经验，会话挂载后以文件形式读写，每次变更都可追溯。」
- **详情**（`Sheet` 或整页右栏）：左侧按路径的树（由 `listMemories` 的 `memory_prefix` 懒加载展开）；右侧选中记忆的内容编辑器（`Textarea`，等宽字体），显示「版本 v3 · 最后修改：智能体（会话 01J…，链接 `/ops/logs/managed/<id>`）/ 用户 xxx · 时间」；「保存」提交 `expected_version`，409 时保留编辑内容并 toast「该记忆已被其他会话或管理员修改，请刷新后再编辑」，提供「查看最新内容」按钮；「新建记忆」对话框（路径 + 内容，路径前端预校验同 §5.1）；「删除记忆」主题化确认对话框。
- **版本历史**（选中记忆下方的表格）：列「版本、操作（新建 / 修改 / 删除）、执行者（用户 / 智能体）、来源会话、大小、时间、操作「查看 / 脱敏」」；已脱敏行显示灰色「已脱敏 · 时间 · 操作人」；脱敏按钮对 head 版本禁用并 tooltip「当前版本不能脱敏」；脱敏确认对话框文案「脱敏会永久抹除该历史版本的路径与内容，仅保留操作记录。」
- **破坏性操作**：归档 / 删除库都用主题化 `Dialog`；删除要求输入库名一致。
- 文案、tooltip 不出现仓库路径或实现细节。i18n：`nav.agentMemory`：zh「记忆库」、en「Memory stores」；页面文案键块 `agentMemory`。
- 注册：`admin-platform-sections.ts` 在 `"agent-vaults"` 后插入 `"agent-memory"`（E06 未合入则在 `"agent-environments"` 后）；`page.tsx` 映射；`AppShell.tsx` 导航项 `{ href: "/admin/agent-memory", labelKey: "agentMemory", icon: BrainCircuit }`（`lucide-react` import 加 `BrainCircuit`）。

### 5.7 文档

`docs/managed-agents/protocol.md` 追加「## Memory Store 控制面（MA-E07）」：公共接口表（§5.4）、路径规则（§5.1 原文）、版本与 CAS 语义（§2 D2/D3）、内部接口示例（§5.5）、错误码表（§5.3）、限额（§2 D6）。

---

## 6. Before / After

| 场景 | Before | After |
|---|---|---|
| 托管会话想要跨会话记忆 | 无 | 管理员建记忆库，会话挂载（A07）后读写文件；每次变更一条版本 |
| 两个会话同时改同一文件 | — | 后写者 CAS 失败（409 `memory_version_conflict`），由 A07 另存冲突文件，不覆盖 |
| 管理员审计 | — | 版本历史显示执行者与来源会话，可脱敏历史版本 |

---

## 7. FR / NFR / AC

| ID | 需求 | AC（测试文件 :: 用例 → 断言） |
|---|---|---|
| FR-1 | 表结构 | `ma-schema.test.ts` 三表列集合 PG / MySQL 一致；`schema-parity.test.ts::mirrors all 84 PostgreSQL tables in MySQL`；MySQL 清单与 journal 含 `0038_ma_memory_stores`；`migration-inventory.test.ts` journal 64 条、末 tag `0064_ma_memory_stores`、磁盘 66 个 `.sql`（以实施时实际值 +1 为准） |
| FR-2 | 路径规则 | `ma-memory-path.test.ts` 表驱动：接受 `/a.md`、`/偏好/报告.md`、`/a/b/c.txt`；NFD 输入 `"/e\u0301.md"` 归一化为 `"/\u00e9.md"`；拒绝 `a.md`、`/`、`/a/`、`/a//b`、`/a/./b`、`/a/../b`、`/a\u0001`、`/a\\b`、1025 字节路径、单段 256 字节；`pathConflicts("/a/b", ["/a"])` → `"/a"`；`pathConflicts("/a", ["/a/b"])` → `"/a/b"`；`pathConflicts("/ab", ["/a"])` → null；`ignorePath` 生效 |
| FR-3 | 内容规则 | 同文件：102400 字节通过、102401 字节拒绝（用 3 字节汉字构造）、含 NUL 拒绝；`contentSha256("")` = `e3b0c442…b855` |
| FR-4 | 版本语义 | `ma-memory-cas.test.ts`（对 `applyMemoryWrite` 的核心逻辑抽出可注入的纯函数 `planMemoryWrite(current, op, allPaths, totals)` 并测试，返回 `{kind:"insert"\|"update"\|"delete"\|"noop"\|"error", ...}`）：create → version 1、版本 operation `created`；update → version 2、`modified`；内容不变 → `noop`；delete → `deleted` 且 version = old+1 |
| FR-5 | 限额 | 同文件：已有 2000 条时 create → `memory_store_limit`；总量 20 MiB − 10 字节时写 11 字节 → `memory_store_limit`；update 用「减旧加新」计算 |
| FR-6 | CAS 冲突（并发会话） | 同文件：`expectedVersion` 落后 → `memory_version_conflict` 且 `current.version` 为最新；两个 `create` 同路径（第二次）→ `memory_path_conflict` |
| FR-7 | CAS 冲突（实库，双写语义） | 手动（§8 实库段）：同一记忆用 `expected_version=1` 连续 PATCH 两次 → 第一次 200（version 2），第二次 409 `memory_version_conflict` 且 `details.current.version == 2`；`psql` 查 `ma_memory_versions` 该 memory 恰 2 行 |
| FR-8 | 公共接口 | `memory-stores-route.test.ts`：只读 PAT 调 POST → 403；POST memory 返回 201 含 `content`；PATCH 缺 `expected_version` 与 `precondition` → 400；`precondition` sha 不符 → 409；repo 抛各错误类 → 状态码与 `error.code` 符合 §5.3；list `view=full&limit=50` → 400 |
| FR-9 | 内部接口校验 | `memory-internal-routes.test.ts`：无 token → 401；会话不存在 → 404 `session_not_found`；会话 `resources` 不含该库 → 403 且消息 `session does not mount this memory store`；`access:"read_only"` 调 writes → 403 `memory store is mounted read_only`，同会话调 snapshot → 200；`MA_MEMORY_INTERNAL_ENABLED=0` → 503 |
| FR-10 | 内部写入逐条结果 | 同文件：三条 op 中第二条 repo 返回冲突 → 响应 `results` 长度 3、`results[1].ok === false`、`code === "memory_version_conflict"`、其余 ok；actor 传入 `{kind:"agent", sessionId}`；`ops` 51 条 → 400 |
| FR-11 | 脱敏 | `ma-memory-cas.test.ts::redact`：head 版本 → `MaMemoryVersionIsHeadError`；已删除记忆的 `deleted` 版本 → head 错误；非 head → 返回 `redacted:true` 且 path / content 为 null |
| FR-12 | 删除前置 | 同文件：未归档删除 → `MaMemoryStoreNotArchivedError`；有 running 会话引用 → `MaMemoryStoreInUseError` |
| FR-13 | 管理页（W4 门） | 手动：`/admin/agent-memory` 新建库与一条记忆 → 编辑保存版本 +1；A07 会话写入后，版本历史出现「智能体 · 会话 01J…」行且链接可打开观测台；对历史版本脱敏后该行灰显；对 head 版本脱敏按钮禁用 |
| FR-14 | 平台页注册 | `admin-platform-sections.test.ts` 含 `"agent-memory"` 且位置正确 |
| NFR-1 | 真落库 | §8 实库检查；接口失败必须返回错误，禁止伪成功 |
| NFR-2 | 类型检查与构建 | db-schema / iam-core / admin-console `typecheck` 与 admin-console `build` 全绿 |
| NFR-3 | 不越界 | `git diff --name-only` 只含 §3.1 文件 |

---

## 8. 验证命令

```bash
cd /Users/damon/myWork/AgenticX/enterprise
env -u DATABASE_URL -u DATABASE_DIALECT pnpm --filter @agenticx/db-schema test
env -u DATABASE_URL -u DATABASE_DIALECT pnpm --filter @agenticx/iam-core test
env -u DATABASE_URL -u DATABASE_DIALECT pnpm --filter @agenticx/admin-console test
pnpm --filter @agenticx/db-schema typecheck
pnpm --filter @agenticx/iam-core typecheck
pnpm --filter @agenticx/admin-console typecheck
pnpm --filter @agenticx/admin-console build
```

实库（`bash scripts/start-dev-with-infra.sh --ui=stream` 起栈后）：

```bash
PAT=<scope 含 ma:memory:read / ma:memory:write>
S=$(curl --noproxy '*' -s -X POST http://127.0.0.1:3001/api/ma/v1/memory_stores -H "Authorization: Bearer $PAT" \
  -H 'content-type: application/json' -d '{"name":"W4 记忆"}' | python3 -c 'import sys,json;print(json.load(sys.stdin)["memory_store"]["id"])')
M=$(curl --noproxy '*' -s -X POST http://127.0.0.1:3001/api/ma/v1/memory_stores/$S/memories -H "Authorization: Bearer $PAT" \
  -H 'content-type: application/json' -d '{"path":"/preferences/report.md","content":"周报用中文"}' | python3 -c 'import sys,json;print(json.load(sys.stdin)["memory"]["id"])')
for i in 1 2; do curl --noproxy '*' -s -o /dev/null -w "%{http_code}\n" -X PATCH http://127.0.0.1:3001/api/ma/v1/memory_stores/$S/memories/$M \
  -H "Authorization: Bearer $PAT" -H 'content-type: application/json' -d "{\"content\":\"v$i\",\"expected_version\":1}"; done   # 期望 200 然后 409
psql "$DATABASE_URL" -c "select version, operation, actor_kind from ma_memory_versions where memory_id='$M' order by version;"
```

---

## 9. 回滚

- 紧急：`MA_MEMORY_INTERNAL_ENABLED=0` → A07 挂载失败，回合以 `memory_mount_failed` 收尾（见 A07）。
- 代码：删除 §3.1 新建文件，`git checkout` 被修改文件。
- 迁移纯新增：`DROP TABLE IF EXISTS "ma_memory_versions"; DROP TABLE IF EXISTS "ma_memories"; DROP TABLE IF EXISTS "ma_memory_stores";` 并删除 `__drizzle_migrations` 对应行（以实际库为准）。

---

## 10. 不变量、风险与待确认问题

### 10.1 不变量

1. 三张记忆表只由 admin-console 进程写入。
2. 每次成功的创建 / 修改 / 删除恰好产生一条版本行；`ma_memory_versions` 除脱敏外从不更新、从不删除（库删除级联除外）。
3. 任何写入都不做 last-writer-wins：更新 / 删除必须带版本或内容哈希前置条件。
4. 现有页面与接口行为不变；`MA_ERROR_CODES` 不变。

### 10.2 风险

1. 应用层前缀冲突检查依赖「每库 ≤2000 条」；并发创建 `/a` 与 `/a/b` 的竞态（两个事务各自通过检查）可能留下文件 / 目录冲突 → A07 落盘时检测并跳过后者（写 `session.error`）。PG 下可在事务里 `SELECT ... FOR UPDATE` 锁 store 行消除竞态：**本子规划要求 `create` 与改路径的 `update` 先锁 store 行**（`SELECT id FROM ma_memory_stores WHERE id = ? FOR UPDATE`），两方言都适用。
2. 记忆内容是不可信输入的沉淀（提示注入可写进记忆，下次会话读回）。调研建议共享知识用 read_only；本子规划在管理页记忆库详情加一行提示「被挂载为读写的记忆库可能沉淀不可信内容，共享知识建议只读挂载」。

### 10.3 须先登记到 master §12 / 待确认问题

- **登记项**：9 个控制面错误码（§5.3）；记忆表采用「单一物理写入方 + CAS」（收紧 §2.3 的双写例外）；迁移编号 0064 / 0038；限额 2000 条 / 20 MiB / 100 KiB。
- **Q1**：记忆库是否需要「按用户 / 部门可见」？当前租户内共享（与四家一致），挂载需 `ma:memory:read` / `ma:memory:write`（A07 D5）。
- **Q2**：管理台权限复用 `kb:*` 是否可接受，还是新增 `memory:*`？
