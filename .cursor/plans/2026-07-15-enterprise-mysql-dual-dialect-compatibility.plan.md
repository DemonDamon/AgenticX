# Enterprise PostgreSQL / MySQL 双方言兼容实施计划

Planned-with: GPT-5.6 Sol

Suggested-Impl-Model: gpt-5.6-sol-medium

> **Plan-Id:** `2026-07-15-enterprise-mysql-dual-dialect-compatibility`  
> **实施入口:** 使用 `executing-plans` skill 按阶段实施；每阶段先写失败测试，再写最小实现。  
> **目标:** 保留 PostgreSQL 作为默认且完全兼容的数据库，同时让同一套 Enterprise 镜像可通过 `DATABASE_DIALECT=mysql` 在 MySQL 8.0 上运行，并提供已有 PostgreSQL 数据停机迁移到 MySQL 的可验证、可回滚流程。  
> **架构:** 应用层只依赖领域 Repository / Store 接口；PostgreSQL 与 MySQL 分别拥有物理 Schema、迁移链和 SQL Adapter。禁止把两种 Drizzle DB 类型或数据库专有 SQL 泄漏到业务/API/UI 层。  
> **技术栈:** TypeScript 5.6、Drizzle ORM 0.45、`pg`、`mysql2`、Go `database/sql`、`pgx` stdlib、`go-sql-driver/mysql`、PostgreSQL 16、MySQL 8.0、Docker Compose、GitHub Actions。

---

## 0. 已确认决策

| 决策项 | 结论 |
|---|---|
| 兼容范围 | PostgreSQL + MySQL 双数据库可选，不下线 PostgreSQL |
| MySQL 基线 | MySQL 8.0；实施首周通过 preflight 锁定目标托管实例的实际 8.0 小版本，CI 使用同一小版本，禁止只用浮动 tag 验证后直接交付 |
| 交付形态 | 同一套 Portal / Admin / Gateway 镜像，通过 `DATABASE_DIALECT` 与 `DATABASE_URL` 在运行时选方言 |
| 新装支持 | PostgreSQL、MySQL 都必须支持空库迁移、seed、启动和全链路验收 |
| 存量迁移 | 支持已有 PostgreSQL 数据迁往 MySQL |
| 割接方式 | 首期只做维护窗口内的停机离线迁移；不做双写、CDC 或近零停机 |
| 默认行为 | 未设置 `DATABASE_DIALECT` 且 `DATABASE_URL` 为现有 PostgreSQL URL 时，行为与当前版本一致 |
| 迁移策略 | 现有 PostgreSQL 迁移链原样保留；MySQL 建独立迁移链；未来每次 schema 变更必须双写迁移并通过 parity gate |

---

## 1. 根因与证据链

当前 Enterprise 不是“数据库连接串写成 PostgreSQL”这么简单，而是从 Schema、驱动到原生 SQL 全链路绑定 PostgreSQL：

1. `enterprise/packages/db-schema/drizzle.config.ts:3-9` 固定 `dialect: "postgresql"`。现有 `drizzle/` 下有 30 个 SQL 文件，但 `meta/_journal.json` 只登记 28 条：磁盘存在重复编号的 `0016_mcp_hosting.sql`，以及未进 journal、后来由 `0028` 覆盖的 `0025_enterprise_runtime_mcp_servers.sql`。双方言实施不能直接按文件名顺序重放。
2. `enterprise/packages/db-schema/src/schema/*.ts` 共 25 个文件，全部基于 `drizzle-orm/pg-core`。代表性绑定：
   - `_shared.ts:2-16`：`timestamp(withTimezone)`、PG `timezone('utc', now())`。
   - `users.ts:27-30`：软删除用户邮箱的 partial unique index。
   - `gateway-audit-events.ts:31-33,66`：`jsonb` 与 GIN 索引。
   - `mcp-servers.ts:17-20`：`jsonb`、`text[]`。
   - `api-tokens.ts:10`：`GENERATED ALWAYS AS IDENTITY`。
3. TypeScript 数据连接固定为 Node PostgreSQL：
   - `enterprise/packages/iam-core/src/db.ts:26-88` 使用 `drizzle-orm/node-postgres` + `pg.Pool`。
   - `enterprise/apps/web-portal/src/lib/chat-history.ts:11-59` 自建 `pg.Pool`。
   - billing / metering 的 6 个 service 文件直接使用 `pg.Pool` 和 `$1` 参数。
4. TypeScript 存在 PG 专有查询：
   - `features/audit/src/services/pg-store.ts:123-128,195-200` 使用 `jsonb @>`。
   - `features/metering/src/services/metering.ts:20-26,98-101` 使用 `date_trunc` 与 `::text`。
   - `features/billing/src/services/split-rules.ts:67-70,110-117` 使用 `::jsonb`、`RETURNING`。
   - `apps/admin-console/src/lib/mcp-servers-store.ts:202-217` 使用 `FILTER`、`IS DISTINCT FROM`、`percentile_cont`。
5. Go Gateway 绑定 `pgxpool` / `lib/pq`：
   - `apps/gateway/go.mod:10-11`。
   - `internal/server/server.go:105-234` 创建 PG pool，并把 `*pgxpool.Pool` 注入审计、计量、配额、PAT、session grant、residency、MCP。
   - `internal/quota/ledger.go:278-283` 使用 `ON CONFLICT ... RETURNING`。
   - `internal/audit/pg_writer.go:83-85` 使用 `timezone('utc', now())`、`ON CONFLICT DO NOTHING`。
6. `enterprise/deploy/docker-compose/dev.yml:1-19`、`prod.yml:24-132` 与 `scripts/start-dev-with-infra.sh:110-127` 只认识 PostgreSQL。
7. `drizzle/0001_smiling_tusk.sql:24-39` 与 `0002_cultured_ma_gnuci.sql:1-26` 还创建了非 Drizzle schema 导出的 PostgreSQL 物化视图 `usage_records_daily_mv`；当前应用代码未引用它，但数据库对象兼容性与外部查询契约必须显式处理。
8. 仓库没有 MySQL 驱动、MySQL schema、MySQL migration、MySQL CI 或 MySQL 性能基线。

因此本计划采用“领域接口 + 双 Adapter + 双物理 Schema/迁移”的方式，不尝试让一份 Drizzle table 定义同时兼容两个 dialect，也不在业务代码中散落 `if (dialect === ...)`。

---

## 2. 目标架构

```mermaid
flowchart TB
    ENV["DATABASE_DIALECT + DATABASE_URL"]
    FACTORY["DatabaseConfig / Repository Factory"]

    subgraph APPS["业务层（无数据库方言）"]
      PORTAL["web-portal"]
      ADMIN["admin-console"]
      GW["Go Gateway"]
      FEATURES["IAM / Policy / Audit / Metering / Billing"]
    end

    subgraph TSADAPTER["TypeScript 数据适配层"]
      PGREPO["PostgreSQL Repositories"]
      MYREPO["MySQL Repositories"]
      PGSCHEMA["pg-core schema + drizzle/"]
      MYSCHEMA["mysql-core schema + drizzle-mysql/"]
    end

    subgraph GOADAPTER["Go 数据适配层"]
      DBX["internal/database Handle"]
      PGQUERY["PostgreSQL query set"]
      MYQUERY["MySQL query set"]
    end

    PG[("PostgreSQL 16")]
    MY[("MySQL 8.0")]

    ENV --> FACTORY
    PORTAL --> FACTORY
    ADMIN --> FACTORY
    FEATURES --> FACTORY
    GW --> DBX
    FACTORY --> PGREPO
    FACTORY --> MYREPO
    PGREPO --> PGSCHEMA --> PG
    MYREPO --> MYSCHEMA --> MY
    DBX --> PGQUERY --> PG
    DBX --> MYQUERY --> MY
```

### 2.1 运行时配置契约

新增：

```env
DATABASE_DIALECT=postgresql  # postgresql | mysql
DATABASE_URL=postgresql://...
```

MySQL：

```env
DATABASE_DIALECT=mysql
DATABASE_URL=mysql://agenticx:password@127.0.0.1:3306/agenticx
```

规则：

- `DATABASE_DIALECT` 显式设置时，URL scheme 必须匹配，否则启动直接失败。
- 为兼容旧部署，变量缺失时仅允许根据 `postgres://` / `postgresql://` 推断 PostgreSQL；生产日志输出一次 deprecation warning。
- MySQL URL 由 Go `internal/database` 转成 driver DSN，并强制补齐 `parseTime=true`、`loc=UTC`、`charset=utf8mb4`。
- 不允许一个进程同时连接两个业务数据库；双库只存在于离线迁移工具。
- 所有数据库时间以 UTC 写入；MySQL session 启动后执行 `SET time_zone = '+00:00'`。

### 2.2 MySQL 数据类型等价规则

| PostgreSQL | MySQL 8.0 | 强制语义 |
|---|---|---|
| `varchar(26)` ULID | `varchar(26)` | `ascii_bin` 或等价 binary collation，大小写敏感 |
| `jsonb` | `json` | 应用入库前 JSON 序列化；查询使用 `JSON_CONTAINS` |
| `text[]` | `json` | 只存 JSON string array；读取后校验 `string[]` |
| `timestamptz` | `datetime(6)` | 一律 UTC；API 输出 ISO-8601 `Z` |
| `boolean` | `boolean` / `tinyint(1)` | Adapter 层统一映射为 JS/Go bool |
| `bigint` | `bigint` | 金额、token 计数禁止转浮点；TS 必要处用 `bigint` 或十进制字符串 |
| identity | `bigint auto_increment` | 数据迁移保留原 ID，迁移后重置 `AUTO_INCREMENT` |
| partial unique index | generated nullable key + unique index | 软删记录不占 active email 唯一键 |
| GIN(jsonb) | 无直接等价 | 首期移除 GIN；按真实查询增加 generated column/index，禁止声称等价 |
| materialized view | 同名普通 VIEW | MySQL 创建 `usage_records_daily_mv` 普通聚合 VIEW；当前无应用调用，不引入定时汇总表；文档明确它不具备物化性能语义 |

`users_tenant_email_active_uq` 在 MySQL 采用：

```sql
active_email_key varchar(320)
  GENERATED ALWAYS AS (
    CASE
      WHEN is_deleted = 0 AND deleted_at IS NULL THEN lower(email)
      ELSE NULL
    END
  ) STORED,
UNIQUE KEY users_tenant_email_active_uq (tenant_id, active_email_key)
```

---

## 3. 范围边界

### In scope

- 42 张现有业务表的 PostgreSQL / MySQL 8.0 schema parity。
- 非表对象 `usage_records_daily_mv` 的名称、列与聚合结果兼容；MySQL 侧只承诺普通 VIEW 语义。
- Portal、Admin、共享 packages、features、Go Gateway 的数据库访问双方言适配。
- 双迁移链、双 seed、双本地开发环境、同镜像运行时切换。
- PostgreSQL → MySQL 停机离线数据迁移、校验、割接和回退 runbook。
- PostgreSQL 16 / MySQL 8.0 CI 矩阵。
- IAM、聊天历史、模型配置、策略、配额、计量、审计、MCP、SSO 数据路径回归。
- 同环境下双方言的 DB-heavy API 相对性能对比。

### Out of scope

- MySQL 5.7、MariaDB、TiDB、OceanBase 等“类 MySQL”兼容承诺。
- PostgreSQL 与 MySQL 同时读写、应用双写、CDC、近零停机迁移。
- 修改 Redis、ClickHouse、ELK、对象存储或模型调用架构。
- 改动 Enterprise UI 视觉或业务流程。
- 为 MySQL 重写业务数据模型或删减现有功能。
- 自动搭建客户云数据库主备、备份、监控；本计划只提供连接与验收契约。
- 顺手修复 `prod.yml` 中与数据库兼容无关的既有部署问题。

---

## 4. 功能需求与验收标准

### FR-1 方言选择

- 同一镜像支持 `postgresql` 与 `mysql`。
- 方言/URL 冲突必须 fail-fast，不得静默回退。

**AC-1**

- `DATABASE_DIALECT=postgresql` + PostgreSQL URL 启动成功。
- `DATABASE_DIALECT=mysql` + MySQL URL 启动成功。
- `DATABASE_DIALECT=mysql` + PostgreSQL URL 在 Portal、Admin、Gateway 启动期均返回可读错误。

### FR-2 空库初始化

- 两种数据库都能从空库执行 migrate + seed。
- 42 张表、列、PK、FK、业务唯一约束和必要索引通过 parity 检查。

**AC-2**

- PostgreSQL 与 MySQL fresh migration 均成功；MySQL 中 `usage_records_daily_mv` 可查询且列集合与 PG 物化视图一致。
- seed 后默认租户、管理员、系统角色、运行时配置数量一致。
- 重跑 migrate 不产生 schema drift。

### FR-3 TypeScript 业务等价

- IAM、auth refresh、chat history、runtime config、policy、audit、metering、billing、MCP store 在双方言结果一致。

**AC-3**

- 同一 fixture 在 PostgreSQL / MySQL 下产生相同 API JSON（忽略数据库内部时间精度差异前先统一到微秒）。
- 软删用户后可重新创建同租户同邮箱；未软删时必须唯一冲突。
- JSON 策略命中、中文搜索、时区、分页排序结果一致。

### FR-4 Gateway 业务等价

- 审计双写、计量、配额累计、请求次数、预算告警、PAT、session grant、MCP registry、residency 均支持 MySQL。

**AC-4**

- 同一审计事件在两种数据库中 checksum / prev_checksum 不因 DB 表示变化而改变。
- 并发 token 累加无丢更新。
- MySQL 故障时保留当前 JSONL / pending 降级语义。

### FR-5 存量迁移

- 提供 PG → MySQL 离线迁移 CLI，支持 dry-run、分批、断点、校验报告。

**AC-5**

- 42 张表 row count 一致。
- 每表 canonical checksum 一致。
- JSON、数组、中文/emoji、UTC 时间、bigint、null、软删记录和 audit chain 专项校验通过。
- 目标已有数据时默认拒绝覆盖；必须显式 `--resume` 或 `--force-empty-target`。

### FR-6 运维与回退

- 提供部署、迁移、割接、回退和故障排查文档。

**AC-6**

- 在用户流量打开前，切回 PostgreSQL 只需恢复原 `DATABASE_DIALECT` / `DATABASE_URL` 并重启三端。
- 一旦 MySQL 对用户开放写入，runbook 明确禁止“直接切回旧 PG”造成新数据丢失。

### NFR

- PostgreSQL 现有测试不得倒退。
- 数据库凭据不得进入日志或迁移报告。
- migration CLI 必须流式处理，不能把大表全量载入内存。
- 相同测试环境下，MySQL 的 DB-heavy API P95 相对 PostgreSQL 劣化超过 20% 时阻断发布并分析；该阈值是内部回归门禁，不是客户 SLA。

---

## 5. 分阶段实施

### Phase 0 — 建立可重复基线与兼容清单

Suggested-Impl-Model: composer-2.5-fast

**Files**

- Create: `enterprise/docs/database/dialect-compatibility-matrix.md`
- Create: `enterprise/scripts/db-compat/list-schema-capabilities.ts`
- Create: `enterprise/scripts/db-compat/__tests__/dialect-contract.test.ts`
- Create: `enterprise/packages/db-schema/src/__tests__/migration-inventory.test.ts`
- Create: `enterprise/packages/db-schema/drizzle/README.md`
- Modify: `enterprise/package.json`

**步骤**

1. 写失败测试：输入 `DATABASE_DIALECT` 与 URL 组合，断言合法/非法矩阵。
2. 增加 schema capability 清单，固定 42 张表、`usage_records_daily_mv` 及 PG 专有能力：JSONB、数组、partial index、GIN、identity、时区、upsert、分析函数。
3. `migration-inventory.test.ts` 解析 `drizzle/meta/_journal.json` 与磁盘 SQL 文件，固定以下事实：
   - journal 有 28 条有效迁移；
   - `0016_mcp_hosting.sql` 与 `0025_enterprise_runtime_mcp_servers.sql` 是已知未登记/重复历史文件；
   - 禁止把这两个文件重放到 MySQL；
   - 不重写、重编号或删除已经发布的 PostgreSQL journal；在 `drizzle/README.md` 记录异常和处置。
4. 在任何实现前跑现有 PostgreSQL 基线并保存命令结果：

```bash
cd enterprise
pnpm typecheck
pnpm test
pnpm e2e:iam
cd apps/gateway && go test ./...
```

5. 记录现有失败；后续只对新增失败负责，不把历史问题混入兼容改造。

**Gate**

- compatibility matrix 能逐项映射到后续 task，不存在“相关 SQL 后面再看”。

---

### Phase 1 — 双 Schema 与双迁移链

Suggested-Impl-Model: gpt-5.6-sol-medium

**Files**

- Keep unchanged as PostgreSQL source of truth: `enterprise/packages/db-schema/src/schema/*.ts`
- Create: `enterprise/packages/db-schema/src/mysql-schema/_shared.ts`
- Create: `enterprise/packages/db-schema/src/mysql-schema/*.ts`（与现有 25 个 schema 文件一一对应）
- Create: `enterprise/packages/db-schema/src/contracts/index.ts`
- Create: `enterprise/packages/db-schema/src/postgres.ts`
- Create: `enterprise/packages/db-schema/src/mysql.ts`
- Create: `enterprise/packages/db-schema/src/dialect.ts`
- Create: `enterprise/packages/db-schema/drizzle.pg.config.ts`
- Create: `enterprise/packages/db-schema/drizzle.mysql.config.ts`
- Create: `enterprise/packages/db-schema/drizzle-mysql/0000_mysql_baseline.sql`
- Create: `enterprise/packages/db-schema/src/__tests__/schema-parity.test.ts`
- Modify: `enterprise/packages/db-schema/package.json`
- Modify: `enterprise/packages/db-schema/src/index.ts`
- Keep: `enterprise/packages/db-schema/drizzle.config.ts` as PostgreSQL-compatible wrapper

**Before**

```ts
export default defineConfig({
  schema: "./src/schema/index.ts",
  out: "./drizzle",
  dialect: "postgresql",
});
```

**After intent**

```ts
// drizzle.pg.config.ts -> schema ./src/schema/index.ts, out ./drizzle
// drizzle.mysql.config.ts -> schema ./src/mysql-schema/index.ts, out ./drizzle-mysql
// drizzle.config.ts re-exports PG config for backward compatibility
```

`package.json` scripts：

```json
{
  "db:generate:pg": "drizzle-kit generate --config drizzle.pg.config.ts",
  "db:generate:mysql": "drizzle-kit generate --config drizzle.mysql.config.ts",
  "db:migrate:pg": "drizzle-kit migrate --config drizzle.pg.config.ts",
  "db:migrate:mysql": "drizzle-kit migrate --config drizzle.mysql.config.ts",
  "db:check:parity": "tsx src/__tests__/schema-parity.test.ts"
}
```

**实现细节**

1. 先写 `schema-parity.test.ts`，读取双方言 table config 并归一化为：
   `table -> columns(name, nullable, logicalType) + PK + FK + logical unique/index`。
2. 测试先失败，因为 MySQL schema 不存在。
3. 创建 MySQL schema，按第 2.2 节规则映射，不复制 PG-only index。
4. `required_scopes` 从 PG `text[]` 映射 MySQL `json`。
5. `users` 与 active quota assignment 的 partial unique index 用 generated nullable key 实现。
6. `gateway_audit_events.policies_hit` 不建伪 GIN；记录为 deliberate divergence。
7. `api_tokens.id` 使用 `autoIncrement()`，类型保持 64 位。
8. `contracts/` 定义 dialect-neutral DTO，业务层禁止从 table `$inferSelect` 直接暴露跨包公共类型。
9. 为 MySQL 生成一份完整 baseline migration；baseline 以当前 42 表最终状态为准，不重放两个未登记/重复 PG 文件；后续新增变更从 `0001_*` 继续。
10. MySQL baseline 创建同名普通 VIEW `usage_records_daily_mv`，使用 `DATE(time_bucket)`、`SUM(...)` 与相同维度分组；schema parity 另行比较其列名与一组 fixture 的聚合结果，不把普通 VIEW 伪装成物化视图。

**Tests**

```bash
pnpm --filter @agenticx/db-schema db:check:parity
pnpm --filter @agenticx/db-schema typecheck
```

断言：

- 42 张表全部存在。
- 业务列、主外键与逻辑唯一约束一致。
- 仅白名单差异可通过：GIN、generated helper columns、物理时间/boolean 类型。

---

### Phase 2 — TypeScript 数据库配置与 Repository 边界

Suggested-Impl-Model: gpt-5.6-sol-medium

**Files**

- Create: `enterprise/packages/iam-core/src/database/config.ts`
- Create: `enterprise/packages/iam-core/src/database/types.ts`
- Create: `enterprise/packages/iam-core/src/database/postgres.ts`
- Create: `enterprise/packages/iam-core/src/database/mysql.ts`
- Create: `enterprise/packages/iam-core/src/database/factory.ts`
- Create: `enterprise/packages/iam-core/src/database/__tests__/config.test.ts`
- Modify: `enterprise/packages/iam-core/src/db.ts`
- Modify: `enterprise/packages/iam-core/src/index.ts`
- Modify: `enterprise/packages/iam-core/package.json`

**设计**

```ts
export type DatabaseDialect = "postgresql" | "mysql";

export type DatabaseConfig =
  | { dialect: "postgresql"; url: string }
  | { dialect: "mysql"; url: string };

export interface QueryExecutor {
  readonly dialect: DatabaseDialect;
  transaction<T>(fn: (tx: QueryExecutor) => Promise<T>): Promise<T>;
}
```

- `resolveDatabaseConfig(env)` 负责显式方言、兼容推断、scheme 冲突校验。
- `createRepositoryRegistry(config)` 返回领域接口，不返回 `NodePgDatabase | MySql2Database` union。
- `getIamDb()` 暂时保留给 PostgreSQL Adapter 内部使用并标记 deprecated；Phase 4 完成后，业务层不得再直接调用。
- 增加 `mysql2`，使用 `drizzle-orm/mysql2`；连接池固定 UTC、utf8mb4、合理 `connectionLimit`。
- 每个 switch 都有 `never` exhaustive guard。

**Tests**

- 先写 `config.test.ts` 覆盖 8 组 env。
- 写 pool lifecycle 测试：singleton、reset、关闭后重建。
- CI 增加静态门禁：除 `database/postgres.ts` 与 PostgreSQL adapter 外，不得新增 `from "pg"`；除 MySQL adapter 外不得新增 `from "mysql2"`。

---

### Phase 3 — IAM / Auth / Runtime Config 双 Adapter

Suggested-Impl-Model: kimi-k2.7-code

**Files**

- Modify interfaces and facades:
  - `enterprise/packages/iam-core/src/repos/users.ts`
  - `repos/departments.ts`
  - `repos/roles.ts`
  - `repos/sso-providers.ts`
  - `repos/audit.ts`
  - `refresh-token-pg-store.ts`
  - `quota-remaining.ts`
  - `runtime-legacy-migrate.ts`
  - `compliance-service.ts`
  - `pat-service.ts`
  - `pat-revocation-store.ts`
  - `session-grant-service.ts`
- Create: `enterprise/packages/iam-core/src/repos/postgresql/*.ts`
- Create: `enterprise/packages/iam-core/src/repos/mysql/*.ts`
- Rename intent, without deleting public APIs:
  - `refresh-token-pg-store.ts` becomes facade; concrete implementations move under dialect folders.
- Add tests under `enterprise/packages/iam-core/src/**/__tests__/` using one shared contract suite.

**实施顺序**

1. 从现有 PostgreSQL 实现提取 Repository interface；外部函数签名不变。
2. 让现有 PG 实现通过 contract suite，确认纯重构无行为变化。
3. 增加 MySQL 实现并复用同一 suite。
4. 针对差异显式实现：
   - `ILIKE` → MySQL case-insensitive collation 或 `lower(column) LIKE lower(?)`。
   - `onConflictDoUpdate` → `onDuplicateKeyUpdate`。
   - `RETURNING` → insert/update 后按业务唯一键回读。
   - JSON array/scopes 读取后 runtime validate。
   - 事务内用户、角色、审计写入保持原子性。

**关键断言**

- 多租户过滤在两种实现中都强制存在。
- 用户邮箱大小写唯一语义一致。
- refresh token rotate/revoke 并发行为一致。
- SSO provider secret 字段不因 JSON/字符集变化损坏。
- legacy runtime import 在同一输入下生成相同记录。

---

### Phase 4 — Portal、Admin 与 Features 双方言

Suggested-Impl-Model: gpt-5.6-sol-medium

**4A. Portal Chat History**

**Files**

- Modify facade: `enterprise/apps/web-portal/src/lib/chat-history.ts:39-454`
- Create: `enterprise/apps/web-portal/src/lib/chat-history/types.ts`
- Create: `enterprise/apps/web-portal/src/lib/chat-history/postgresql.ts`
- Create: `enterprise/apps/web-portal/src/lib/chat-history/mysql.ts`
- Create: `enterprise/apps/web-portal/src/lib/chat-history/contract.test.ts`

保留现有导出函数；内部委托 `ChatHistoryStore`。共享 contract suite 覆盖：

- create/list/rename/soft-delete session；
- append/replace messages 的事务与顺序；
- ownership / tenant isolation；
- `syncAuthUserToPostgres` 重命名为中性内部实现，旧导出保留一版兼容 alias。

**4B. Admin 直接 Store**

**Files**

- Modify facades:
  - `apps/admin-console/src/lib/token-quota-store.ts`
  - `user-models-store.ts`
  - `dept-models-store.ts`
  - `model-providers-store.ts`
  - `mcp-proxy-store.ts`
  - `quota-plans-store.ts`
  - `agent-trace-store.ts`
  - `gateway-channels-store.ts`
  - `budget-store.ts`
  - `pricing-store.ts`
  - `mcp-servers-store.ts`
- Create: `apps/admin-console/src/lib/db-stores/postgresql/*.ts`
- Create: `apps/admin-console/src/lib/db-stores/mysql/*.ts`
- Create shared contract tests beside each facade.

`mcp-servers-store.ts:202-217` 的 MySQL p50：

```sql
WITH ranked AS (
  SELECT latency_ms,
         ROW_NUMBER() OVER (ORDER BY latency_ms) AS rn,
         COUNT(*) OVER () AS cnt
  FROM gateway_audit_events
  WHERE ...
)
SELECT MIN(CASE WHEN rn >= CEIL(cnt * 0.5) THEN latency_ms END) AS p50_latency_ms
FROM ranked
```

失败数使用 `SUM(CASE WHEN mcp_status <> 'ok' OR mcp_status IS NULL THEN 1 ELSE 0 END)`。

**4C. Features**

**Files**

- Audit:
  - Keep `features/audit/src/services/pg-store.ts`
  - Create `features/audit/src/services/mysql-store.ts`
  - Create `features/audit/src/services/factory.ts`
- Policy:
  - Keep `features/policy/src/services/pg-store.ts`
  - Create `features/policy/src/services/mysql-store.ts`
  - Create `features/policy/src/services/factory.ts`
- Metering/Billing:
  - Modify `features/metering/src/services/metering.ts`
  - Modify `features/metering/src/services/roi.ts`
  - Modify `features/billing/src/services/split-rules.ts`
  - Modify `features/billing/src/services/settlement-contract.ts`
  - Modify `features/billing/src/services/split-ledger.ts`
  - Create dialect query builders under each feature `src/services/sql/{postgresql,mysql}.ts`

**必须写全的 SQL 等价**

- `jsonb @>` → `JSON_CONTAINS(policies_hit, CAST(? AS JSON))`。
- `date_trunc('hour'|'day', time_bucket)` → `DATE_FORMAT` / `TIMESTAMP` 归一化，并在返回层输出 UTC bucket。
- `$n::jsonb` → `CAST(? AS JSON)`。
- `RETURNING *` → 写入后按 PK / unique key 查询。
- `COUNT(*) FILTER` → `SUM(CASE WHEN ... THEN 1 ELSE 0 END)`。
- 所有动态列名继续使用既有 allowlist，禁止将 dialect 改造变成 SQL 注入入口。

**Tests**

- 每个 store 使用同一 fixture 在两种数据库跑 contract suite。
- Audit policy filter、chain verify、CSV export 必须逐字节一致。
- Metering heatmap 的 hour/day bucket 必须一致。
- Billing 金额以 micro-USD bigint 比较，禁止 Number 精度损失。

---

### Phase 5 — Go Gateway 统一 `database/sql` 双方言层

Suggested-Impl-Model: gpt-5.6-sol-medium

**Files**

- Create:
  - `enterprise/apps/gateway/internal/database/dialect.go`
  - `internal/database/config.go`
  - `internal/database/handle.go`
  - `internal/database/rebind.go`
  - `internal/database/errors.go`
  - `internal/database/*_test.go`
- Modify:
  - `apps/gateway/go.mod`
  - `internal/server/server.go:105-234`
  - `internal/server/health.go`
  - `internal/audit/pg_writer.go`
  - `internal/audit/backfill.go`
  - `internal/metering/reporter.go`
  - `internal/metering/trace_reporter.go`
  - `internal/quota/tracker.go`
  - `internal/quota/request_count.go`
  - `internal/quota/ledger.go`
  - `internal/quota/budget_alert_reporter.go`
  - `internal/residency/store.go`
  - `internal/auth/session_grant.go`
  - `internal/auth/pat.go`
  - `internal/mcphost/host.go`
  - `internal/mcphost/registry.go`

**Before**

```go
var pgPool *pgxpool.Pool
pool, err := audit.NewPgxPool(dbURL)
srv.quotaTracker = quota.NewTracker(..., pgPool)
```

**After intent**

```go
type Dialect string
const (
    PostgreSQL Dialect = "postgresql"
    MySQL      Dialect = "mysql"
)

type Handle struct {
    Dialect Dialect
    DB      *sql.DB
}

handle, err := database.OpenFromEnv()
srv.quotaTracker = quota.NewTracker(..., handle)
```

**实现约束**

1. 使用 `database/sql` 作为共同连接接口。
2. PostgreSQL 使用 `github.com/jackc/pgx/v5/stdlib`；MySQL 使用 `github.com/go-sql-driver/mysql`。完成后移除 `lib/pq`；`pgx` 仅保留 stdlib。
3. 普通 SQL 统一写 `?` placeholder，由 `Rebind` 仅为 PostgreSQL 转 `$1...$n`。`Rebind` 必须实现最小 SQL lexer，跟踪单引号、双引号、反引号、`--` 行注释与 `/* */` 块注释，只替换语法层 placeholder，不能替换字符串或注释里的 `?`。
4. upsert、JSON、数组和分析 SQL 使用 dialect-specific query builder，不强行做字符串替换。
5. `ledger.go` 的并发累加：
   - PostgreSQL 保留 `ON CONFLICT ... RETURNING`。
   - MySQL 在事务内执行 `INSERT ... VALUES (?,...) ON DUPLICATE KEY UPDATE used_total = gateway_quota_pool_usage.used_total + ?`（`delta` 作为最后一个参数再次绑定），随后 `SELECT used_total ... FOR UPDATE`；不用已弃用的 `VALUES(column)` 写法，并用并发测试证明无丢更新。
6. Audit duplicate：
   - PostgreSQL `ON CONFLICT DO NOTHING`。
   - MySQL `ON DUPLICATE KEY UPDATE id = id`（单表 insert 的显式 no-op）；禁止 `INSERT IGNORE` 吞掉非唯一约束错误。
7. JSON 使用 `json.RawMessage` / `[]byte`，scan 后校验；`required_scopes` 从 MySQL JSON 解为 `[]string`。
8. `server.go` 字段从 `pgPool` 改为中性 `database *database.Handle`，日志不得再把 MySQL 失败写成 `audit pg unavailable`。
9. `readyz` 返回 key 仍可用通用 `database`，并额外带 `dialect`；不要破坏现有监控对 `postgres` key 的依赖，过渡期同时保留 deprecated `postgres` 状态。

**Tests**

- `rebind_test.go`：普通 placeholder 被替换；单/双引号、反引号、行注释、块注释与 JSON path 中的 `?` 均保持不变；未闭合字符串/注释直接返回错误。
- `config_test.go`：URL → DSN、时区和凭据脱敏。
- 各 store table-driven contract：PostgreSQL / MySQL。
- `ledger_test.go`：100 goroutine 同 key 累加，最终值准确。
- `audit`：重复 ID 幂等，其他约束错误可见。
- `backfill`：同一 pending 文件重复回灌不重复。

```bash
cd enterprise/apps/gateway
go test ./...
go test -race ./internal/quota ./internal/audit ./internal/auth ./internal/mcphost
```

---

### Phase 6 — 双方言 migrate / seed / bootstrap / Compose

Suggested-Impl-Model: composer-2.5-fast

**Files**

- Modify:
  - `enterprise/packages/db-schema/scripts/db-seed.mjs`
  - `enterprise/scripts/bootstrap.sh`
  - `enterprise/scripts/start-dev.sh`
  - `enterprise/scripts/start-dev-with-infra.sh:22-154`
  - `enterprise/deploy/docker-compose/dev.yml`
  - `enterprise/deploy/docker-compose/prod.yml`
  - `enterprise/.env.local.example:17-19`
  - `enterprise/docs/configuration/env-vars.md:10-23,63-73`
- Create:
  - `enterprise/packages/db-schema/scripts/db-migrate.mjs`
  - `enterprise/packages/db-schema/scripts/db-seed-mysql.mjs`
  - `enterprise/deploy/docker-compose/mysql-init/00-session.sql`

**CLI 契约**

```bash
bash scripts/start-dev-with-infra.sh --db=postgresql
bash scripts/start-dev-with-infra.sh --db=mysql
pnpm --filter @agenticx/db-schema db:migrate
pnpm --filter @agenticx/db-schema db:seed
```

- `db:migrate` / `db:seed` 从 `DATABASE_DIALECT` 选择实现，保持上层命令不变。
- `dev.yml` 用 Compose profiles 隔离 `postgres` 与 `mysql`，默认仍起 PostgreSQL。
- MySQL service：`mysql:8.0`、`utf8mb4`、UTC、strict sql mode、healthcheck `mysqladmin ping`。
- `start-dev-with-infra.sh` 只启动所选数据库 + Redis，并等待对应健康状态。
- `prod.yml` 不允许 PostgreSQL 与 MySQL 同时作为同一环境的主库；使用 profile 与 env 模板明确二选一。
- `prod.yml` 的 gateway、web-portal、admin-console 三个 service 都必须显式接收同一组 `DATABASE_DIALECT` 与 `${DATABASE_URL}`；替换当前 gateway 中硬编码 PostgreSQL URL，并补齐当前 Portal/Admin 缺失的数据库变量。除此之外不修复 prod 模板的无关问题。
- seed 输出内容在两种数据库一致，不输出密码 hash 或连接凭据。

**Tests**

- shell 参数测试覆盖默认值、非法 `--db`、`--down`、`--infra-only`。
- PostgreSQL 与 MySQL 空卷各跑两次 migrate + seed。

---

### Phase 7 — PostgreSQL → MySQL 离线迁移工具

Suggested-Impl-Model: gpt-5.6-sol-medium

**Files**

- Create:
  - `enterprise/scripts/db-portability/migrate-pg-to-mysql.ts`
  - `enterprise/scripts/db-portability/config.ts`
  - `enterprise/scripts/db-portability/table-manifest.ts`
  - `enterprise/scripts/db-portability/transforms.ts`
  - `enterprise/scripts/db-portability/checksum.ts`
  - `enterprise/scripts/db-portability/report.ts`
  - `enterprise/scripts/db-portability/__tests__/*.test.ts`
  - `enterprise/scripts/db-portability/fixtures/edge-cases.ts`
- Modify: `enterprise/package.json`

**命令**

```bash
PG_SOURCE_DATABASE_URL=postgresql://... \
MYSQL_TARGET_DATABASE_URL=mysql://... \
pnpm db:migrate:pg-to-mysql --dry-run

pnpm db:migrate:pg-to-mysql --batch-size 1000 --report .runtime/db-migration-report.json
pnpm db:verify:pg-to-mysql --report .runtime/db-migration-report.json
```

**表顺序**

清单显式维护 42 张表，父表先于子表；`usage_records_daily_mv` 是目标 migration 创建的 VIEW，不作为数据搬运表：

1. `tenants`, `organizations`, `departments`, `users`, `roles`, `user_roles`
2. `sso_providers`, `auth_refresh_sessions`, `session_grants`, `api_tokens`
3. `chat_sessions`, `chat_messages`
4. `policy_rule_packs`, `policy_rules`, `policy_rule_versions`, `policy_publish_events`
5. `enterprise_runtime_model_providers`, `enterprise_runtime_user_visible_models`, `enterprise_runtime_token_quotas`, `enterprise_runtime_policy_snapshots`, `enterprise_runtime_pricing`, `enterprise_runtime_budgets`, `enterprise_runtime_compliance`, `enterprise_runtime_pat_revocation`, `enterprise_runtime_mcp_servers`
6. `enterprise_quota_plans`, `enterprise_quota_plan_assignments`
7. `gateway_channels`, `mcp_servers`, `mcp_tools`
8. `usage_records`, `agent_token_traces`, `enterprise_business_revenue`
9. `billing_split_rules`, `billing_split_ledger`, `billing_settlement_webhook_config`, `billing_settlement_webhook_events`
10. `audit_events`, `gateway_audit_events`, `gateway_budget_alerts`, `gateway_quota_pool_usage`, `gateway_quota_ledger`

`departments.parent_id` 等自引用表按父深度排序。不得用全局 `FOREIGN_KEY_CHECKS=0` 掩盖顺序错误。

**转换与校验**

- JSONB / array：parse 后重新以 canonical JSON 写 MySQL JSON。
- timestamp：统一 UTC，保留到双方言共同支持的微秒精度。
- bigint：以十进制字符串过转换层。
- boolean：显式 bool，不依赖 driver 隐式转换。
- `api_tokens.id`：保留 ID，完成后把 auto increment 调到 `MAX(id)+1`。
- 每批一个 target transaction；checkpoint 记录最后一个稳定排序 PK。
- 迁移报告不记录密码 hash、provider secret、SSO secret、PAT hash 的原值。
- canonical checksum：按 PK 排序；JSON key 排序；时间 ISO UTC；bigint decimal string；null 保留。

**失败测试先行**

- 中文姓名与 emoji。
- JSON 嵌套对象 key 顺序不同但 checksum 相同。
- soft-deleted 同邮箱多行。
- DST 边界时间输入后仍为相同 UTC instant。
- `bigint > Number.MAX_SAFE_INTEGER`。
- audit chain 连续 10 条与一个故意损坏样本。
- 中途失败后 `--resume` 不重复插入。

---

### Phase 8 — CI 双矩阵与性能门禁

Suggested-Impl-Model: composer-2.5-fast

**Files**

- Create: `.github/workflows/enterprise-db-compat.yml`
- Create: `enterprise/scripts/ci/run-db-contract-suite.sh`
- Create: `enterprise/scripts/ci/seed-db-compat-fixture.ts`
- Create: `enterprise/docs/perf-baselines/db-dialect-comparison.md`
- Modify only if needed: `.github/workflows/security-scan.yml`

**CI matrix**

```yaml
strategy:
  matrix:
    database: [postgresql, mysql]
```

每个矩阵：

1. 启对应 service。
2. fresh migrate。
3. seed。
4. schema parity。
5. `pnpm typecheck && pnpm test`。
6. `pnpm e2e:iam`。
7. Gateway `go test ./...`。
8. 登录 → 用户/角色 → chat → policy → audit → metering → MCP smoke。

额外 migration job：

1. 起 PG + MySQL。
2. PG seed edge fixture。
3. 跑迁移。
4. verify counts/checksums/audit chain。
5. 用迁移后的 MySQL 启动三端并跑 smoke。

**性能门禁**

- 使用相同机器、相同 fixture、相同 VU 运行现有 Gateway / app baseline。
- 报告双方言连接池、QPS、P50/P95、错误率、CPU。
- 只建立相对回归基线，不对外承诺绝对并发或延迟。

---

### Phase 9 — 割接、回退、文档与最终验收

Suggested-Impl-Model: gpt-5.6-sol-medium

**Files**

- Create:
  - `enterprise/docs/runbooks/mysql-deployment.md`
  - `enterprise/docs/runbooks/postgresql-to-mysql-offline-migration.md`
  - `enterprise/docs/runbooks/database-dialect-rollback.md`
- Modify:
  - `enterprise/docs/database/schema.md`
  - `enterprise/docs/development/troubleshooting.md`
  - `enterprise/docs/configuration/env-vars.md`
  - `enterprise/README.md`

**停机迁移顺序**

```mermaid
sequenceDiagram
    participant OP as 运维
    participant APP as Portal/Admin/Gateway
    participant PG as PostgreSQL
    participant TOOL as 迁移工具
    participant MY as MySQL

    OP->>APP: 从 SLB 摘流量并停止写服务
    OP->>PG: 创建最终快照/备份并记录 schema version
    OP->>MY: fresh migrate（不执行业务 seed）
    OP->>TOOL: dry-run / preflight
    TOOL->>PG: 分批只读
    TOOL->>MY: 按 FK 顺序事务写入
    TOOL->>PG: canonical checksum
    TOOL->>MY: canonical checksum + audit chain verify
    OP->>APP: 改 DATABASE_DIALECT=mysql 后启动
    OP->>APP: 内网 smoke（仍不开放用户流量）
    alt 验收通过
        OP->>APP: 恢复 SLB 流量
    else 验收失败
        OP->>APP: 停止 MySQL 版并恢复 PG 配置
        OP->>APP: 重新启动并验证 PG
    end
```

**Go / No-Go 门禁**

- PG 最终备份可恢复。
- 迁移报告 42 张表全部 green。
- audit chain、登录、聊天、策略、配额、计量、MCP smoke 全通过。
- 用户流量打开前可无数据损失回退。
- 用户流量打开后，旧 PG 不再是最新数据；禁止直接回切。若必须回退，需另行执行 MySQL 增量导出/人工核验方案。

**最终命令**

```bash
cd enterprise
pnpm install --frozen-lockfile
pnpm --filter @agenticx/db-schema db:check:parity
pnpm typecheck
pnpm test
pnpm e2e:iam
cd apps/gateway
go test ./...
go test -race ./internal/quota ./internal/audit ./internal/auth ./internal/mcphost
```

分别在 PostgreSQL / MySQL 环境执行完整一遍；不能只跑默认 PostgreSQL。

---

## 6. 测试数据最小集合

双方言 contract 与迁移 fixture 至少包含：

- 2 tenants、3 organizations、10 departments（含 3 层树）、50 users。
- 大小写相同邮箱、软删后重建邮箱、中文姓名、emoji、空值。
- owner/admin/auditor/member + 自定义 role/scopes。
- OIDC 与 SAML provider（secret 使用测试密钥）。
- 10 chat sessions、每个 20 messages、含 metadata JSON。
- draft/active/deleted policy，`applies_to` 与 `policies_hit` JSON。
- 100 usage records，跨小时、日、月和 UTC 日期边界。
- 10 API token、session grant、revocation。
- 20 MCP servers/tools，`required_scopes` string array。
- 100 条连续 audit chain + 1 个故意损坏样本。
- bigint 边界、billing micro-USD、quota 并发累加。

---

## 7. 风险与缓解

| 风险 | 缓解与门禁 |
|---|---|
| Drizzle 双方言类型 union 导致类型退化 | DB client 不跨 Repository 边界；双方言实现各自强类型，业务只见 interface |
| 双迁移链长期漂移 | `schema-parity.test.ts` + CI 双 fresh migration；PR 模板要求同一 schema 变更同时提供 PG/MySQL migration |
| MySQL 无 partial unique / GIN | generated nullable key 保软删唯一语义；GIN 明确降级并用真实查询压测决定 generated index |
| JSON 查询语义不同 | 同 fixture contract test；所有 JSON predicate 集中在 dialect adapter |
| MySQL 无 `RETURNING` | 写后按 PK/unique key 回读；并发路径用 transaction + lock |
| token / 金额 bigint 精度丢失 | 转换层使用 bigint/decimal string；禁止 `Number()` |
| 时区漂移 | DB session UTC + `datetime(6)` + API ISO UTC contract |
| 审计链迁移损坏 | checksum 基于逻辑事件；迁移前后 full chain verify |
| 双数据库支持扩大维护成本 | 明确 owner；每个 schema/query 变更必须双实现，不允许“暂时只改 PG” |
| 停机时间超预期 | dry-run 测吞吐、batch/checkpoint、按最大表估算窗口；正式前至少一次全量演练 |
| 回退造成新数据丢失 | 用户流量开放前完成 go/no-go；开放后禁止直接切旧 PG |
| MySQL 供应商参数不兼容 | preflight 检查版本、sql_mode、charset、collation、time_zone、权限、max_allowed_packet |

---

## 8. 工作量、并行度与推荐模型

| 子规划 | 人周 | 依赖 | 推荐模型 | 理由 |
|---|---:|---|---|---|
| Phase 0 基线 | 0.5 | 无 | composer-2.5-fast | 清单与测试骨架，机械性强 |
| Phase 1 Schema / migrations | 2.0–2.5 | P0 | gpt-5.6-sol-medium | 数据语义与迁移风险最高 |
| Phase 2–3 TS DB / IAM | 2.0–2.5 | P1 | kimi-k2.7-code | 代码量大、接口明确，适合代码专精模型 |
| Phase 4 Portal/Admin/Features | 2.0–2.5 | P2 | gpt-5.6-sol-medium | 跨模块 SQL 等价与回归风险高 |
| Phase 5 Go Gateway | 2.0–2.5 | P1/P2 | gpt-5.6-sol-medium | 并发计量、审计一致性敏感 |
| Phase 6 部署接线 | 0.5–1.0 | P1/P2 | composer-2.5-fast | Compose/脚本接线边界清晰 |
| Phase 7 数据迁移 | 1.5–2.0 | P1–P5 | gpt-5.6-sol-medium | 数据正确性、断点与校验高风险 |
| Phase 8–9 CI/收口 | 1.0–1.5 | 全部 | gpt-5.6-sol-medium | 跨栈验收和割接决策 |
| **合计** | **11.5–15.0 人周** | | | |

推荐 3 条并行线：

```mermaid
flowchart LR
    P0["P0 基线"] --> P1["P1 Schema"]
    P1 --> TS["P2/P3/P4 TypeScript"]
    P1 --> GO["P5 Gateway"]
    P1 --> OPS["P6 部署"]
    TS --> MIG["P7 数据迁移"]
    GO --> MIG
    OPS --> MIG
    MIG --> CI["P8/P9 验收收口"]
```

2–3 名工程师并行、需求不扩张时，建议按 5–7 周项目窗口排期；若只有 1 人，按 12–15 周更现实。该估算不含客户侧数据库采购、网络审批、历史脏数据专项治理。

---

## 9. 提交与审查策略

计划实施时建议拆分为以下可独立回退的 commits：

1. `test(db): lock PostgreSQL behavior and dialect contract`
2. `feat(db-schema): add MySQL schema and migration baseline`
3. `refactor(iam-core): introduce dialect-neutral repository boundary`
4. `feat(iam-core): add MySQL repositories`
5. `feat(portal): add MySQL chat history adapter`
6. `feat(admin): add MySQL runtime stores`
7. `feat(features): add MySQL audit policy metering billing adapters`
8. `refactor(gateway): introduce dialect-neutral database handle`
9. `feat(gateway): add MySQL persistence adapters`
10. `feat(deploy): add MySQL runtime profile`
11. `feat(migration): add PostgreSQL to MySQL offline migrator`
12. `ci(enterprise): verify PostgreSQL and MySQL matrices`
13. `docs(enterprise): add MySQL deployment and cutover runbooks`

每个 commit：

- 只暂存本阶段直接改动。
- 使用 `/commit --spec=.cursor/plans/2026-07-15-enterprise-mysql-dual-dialect-compatibility.plan.md`。
- trailer 顺序固定为 `Plan-Id` → `Plan-File` → `Plan-Model` → `Impl-Model` → `Made-with: Damon Li`。
- `Impl-Model` 必须填写实际实施模型，不能沿用本计划建议值冒充实际值。
- 每个阶段完成后运行 `/codeview --spec`，阻塞问题修复并重新审查后才能进入下一阶段。

---

## 10. 完成定义

- [ ] PostgreSQL 默认路径完全兼容，无现有行为回退。
- [ ] MySQL 8.0 空库 migrate + seed + 三端启动成功。
- [ ] 42 表 schema parity gate 通过。
- [ ] `usage_records_daily_mv` 在 MySQL 以普通 VIEW 提供同名列与一致聚合结果，性能语义差异已写入文档。
- [ ] PostgreSQL 28 条 journal 与 30 个磁盘 SQL 文件的历史异常已被 inventory gate 固定，MySQL baseline 未误重放重复/孤儿文件。
- [ ] TS shared contract suite 在双方言全绿。
- [ ] Gateway contract/race tests 在双方言全绿。
- [ ] PG → MySQL fixture 与一次接近生产规模的演练迁移通过。
- [ ] row count、canonical checksum、audit chain 全绿。
- [ ] IAM、聊天、策略、配额、计量、审计、MCP、SSO 全链路验收通过。
- [ ] CI 双数据库矩阵为 required check。
- [ ] 性能对比完成，未出现未解释的 >20% DB-heavy P95 回退。
- [ ] 部署、割接、回退、故障排查文档完成。
- [ ] 所有实现 commits 均带 Plan-Id / Plan-File / model / Made-with trailers。
- [ ] 本计划文件与代码一同提交，未遗漏。
