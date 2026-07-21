# @agenticx/iam-core 模块总结

> 结论生成时间：2026-07-21（重新生成，覆盖当前代码 v0.1.0）

> 说明：本文档描述 **企业 IAM 数据访问层包**（`@agenticx/iam-core`）。它是 web-portal + admin-console 共用的数据访问层，**同时支持 PostgreSQL 与 MySQL 两种方言**（基于 `@agenticx/db-schema` 的 Drizzle 双 schema）。本次重新生成相对旧版的主要订正：旧版仅描述 PostgreSQL，当前代码已全面引入方言派发（`database/` 子目录 + 各 service/repo 的 dialect 分支）。

## 模块概述

`@agenticx/iam-core`（v0.1.0，workspace 包路径 `enterprise/packages/iam-core`，`package.json#description` 现为 "Enterprise IAM repositories (Drizzle, PostgreSQL / MySQL)"）是 AgenticX Enterprise IAM（Identity & Access Management）的**数据访问层**。它包装 `@agenticx/db-schema` 表（通过 Drizzle ORM），暴露**类型化的仓库函数**和少量**高层服务**（PAT、session grants、合规、配额、运行时配置迁移、信封加密），并产出**供 gateway 推理时使用的 "snapshot" payloads**。

依赖：`@agenticx/auth`（认证契约）+ `@agenticx/db-schema`（Drizzle 双 schema）+ `drizzle-orm` + `pg` + `mysql2` + `ulid`。测试用 `vitest`。

## 目录结构

```
packages/iam-core/
├── package.json                          # workspace pkg；exports . / scope-registry / provider-api-key-crypto / runtime-legacy-migrate；deps 含 mysql2
└── src/
    ├── index.ts                          # barrel —— re-export 全部
    ├── db.ts                             # 入口：deprecate getIamDb/getIamPool（PG-only），新导出 resolveDatabaseConfig / RepositoryRegistry / QueryExecutor / createMysqlDb 等
    ├── database/                          # ⚡ 方言派发核心（新增）
    │   ├── config.ts                      # resolveDatabaseConfig：按 DATABASE_DIALECT + DATABASE_URL 解析方言
    │   ├── types.ts                       # QueryExecutor / RepositoryRegistry 方言中立接口
    │   ├── factory.ts                     # createRepositoryRegistry / getRepositoryRegistry / getQueryExecutorSync 单例
    │   ├── postgres.ts                    # PG drizzle 客户端 + pgSchema（23 张 IAM/runtime 子集表）+ Pool + QueryExecutor
    │   └── mysql.ts                       # MySQL drizzle 客户端（schema 全量 import @agenticx/db-schema/mysql）+ mysql2 Pool + QueryExecutor
    ├── scope-registry.ts                  # 静态 SCOPE_REGISTRY + scope 合并/检查辅助
    ├── provider-api-key-crypto.ts         # AES-256-GCM 信封加密 for provider API keys
    ├── runtime-legacy-migrate.ts          # 一次性磁盘→DB 迁移 legacy runtime JSON（按方言分支）
    ├── pg-auth-user-repository.ts         # 现为 facade：MySQL 方言委托给 mysql-auth-user-repository，否则走 PG
    ├── mysql-auth-user-repository.ts      # ⚡ MySQL 的 AuthUserRepository 实现（新增）
    ├── refresh-token-pg-store.ts          # 现为 facade：按方言委托给 MysqlRefreshTokenStore 或 PostgresqlRefreshTokenStore
    ├── pat-service.ts                     # Personal Access Token 生命周期（按方言分支）
    ├── pat-revocation-store.ts            # PAT 吊销 snapshot for gateway（按方言分支）
    ├── session-grant-service.ts           # 管理员签发的临时 session grants（按方言分支）
    ├── compliance-service.ts              # 跨境/审计保留合规配置（ComplianceStore 抽象，按方言分支）
    ├── quota-remaining.ts                 # 租户/部门/用户/PAT 配额剩余汇总（按方言分支）
    ├── repos/
    │   ├── contracts.ts                   # ⚡ 方言中立接口：AuditRepository / UsersRepository / DepartmentsRepository / RolesRepository / SsoProvidersRepository
    │   ├── users.ts                       # PG 实现 + 委托 mysqlUsersRepository（MySQL）
    │   ├── departments.ts                # PG 实现 + 委托 mysqlDeptsRepo（MySQL）
    │   ├── roles.ts                      # PG 实现 + 委托 mysqlRolesRepo（MySQL）
    │   ├── sso-providers.ts              # PG 实现 + 委托 mysqlSsoRepository（MySQL）
    │   ├── audit.ts                      # 通过 AuditRepository 抽象委托 mysqlAuditRepository / postgresqlAuditRepository
    │   └── __tests__/sso-providers.test.ts
    └── __tests__/
        ├── quota-remaining.test.ts
        └── runtime-legacy-migrate.test.ts
```

## 方言派发架构（核心变更）

旧版结论把本包描述为 PostgreSQL 专用。当前代码引入了一套方言中立层：

### `database/config.ts` — `resolveDatabaseConfig`
- 读 `DATABASE_DIALECT` + `DATABASE_URL`（缺失方言时可由 `postgres(ql)://` 或 `mysql://` URL 推断）
- 非 prod 下 URL 缺失回落到本地 PG（`postgresql://postgres:postgres@127.0.0.1:5432/agenticx`）
- 保留历史行为：本地 PG URL 自动补 `sslmode=disable`
- 返回 `DatabaseConfig = { dialect: "postgresql"|"mysql"; url: string }`

### `database/types.ts` — 方言中立接口
- `QueryExecutor { dialect; transaction(fn) }` —— 具体 Drizzle 客户端留在 `postgres.ts` / `mysql.ts` 内
- `RepositoryRegistry { dialect; executor }`

### `database/factory.ts` — 单例注册表
- `createRepositoryRegistry(config)` 按 `config.dialect` 构造 PG 或 MySQL executor
- `getRepositoryRegistry()` 懒初始化单例（dialect/url 变化时重建）
- `getQueryExecutorSync()` 要求启动期先 `await getRepositoryRegistry()`
- `__resetDatabaseForTests()` 同时重置 PG 与 MySQL 单例

### `database/postgres.ts`
- `pgSchema` 把 `@agenticx/db-schema` 的 **23 张** IAM/runtime 相关表打包（users, departments, organizations, roles, user_roles, sso_providers, audit_events, gateway_audit_events, enterprise_runtime_*、enterprise_quota_*、gateway_budget_alerts、gateway_quota_pool_usage、session_grants、auth_refresh_sessions、agent_token_traces）
- `createPgPool` / `createPgDb`（drizzle-orm/node-postgres + pg Pool，`max: 10`，全局单例 `__agenticxIamPgPool`）
- `createPgQueryExecutor`：`transaction` 内把 drizzle tx 挂到 executor 的 `__pgDb` 字段供适配器取用；`getPgDrizzle` 取底层客户端

### `database/mysql.ts`
- `import * as mysqlSchema from "@agenticx/db-schema/mysql"`（**全量** MySQL schema，42 张表）
- `createMysqlPool`：`mysql2/promise` Pool，`connectionLimit: 10`，`timezone: "Z"`，`charset: "utf8mb4"`；每条连接 `SET time_zone = '+00:00'` 强制 UTC；URL 用 `new URL()` 解析
- `createMysqlDb`：`drizzle(pool, { schema: mysqlSchema, mode: "default" })`，全局单例 `__agenticxIamMysqlPool`
- `MySqlIamDb = { dialect: "mysql"; raw: MySqlDrizzleDb }`

### `db.ts` — 入口与 deprecation
- 新代码应优先 `resolveDatabaseConfig` / `getRepositoryRegistry`
- `getIamDb()` / `getIamPool()` 标记 `@deprecated`，**仅 PostgreSQL 可用**，当前方言非 PG 时直接抛错引导改用 `getRepositoryRegistry()`
- 仍导出 `IamDb` / `IamDbSchema`（PG 类型别名）与 `schema`（= `pgSchema`）以兼容旧 adapter
- `__resetIamDbForTests` 仅重置 PG（MySQL 走 factory 的 `__resetDatabaseForTests`）

### `repos/contracts.ts` — 方言中立仓库接口
定义 `DialectRepository`（带 `readonly dialect`）及五个仓库接口：`AuditRepository`、`UsersRepository`、`DepartmentsRepository`、`RolesRepository`、`SsoProvidersRepository`，PG 与 MySQL 实现都遵守这些接口。`DepartmentsRepository` 含 `listDepartmentAncestorIds` 与 `listDepartmentSubtreeIds`。

## Repos —— 职责与关键导出

### `repos/users.ts`
**职责**：租户的 admin 用户生命周期（PG 实现，MySQL 委托 `mysqlUsersRepository`）

**类型**：`AdminUserDto`, `AdminUserStatus`, `ListUsersFilter`, `ListUsersResult`, `UpdateAdminUserInput`

**函数**：
- `loadAuthUserByEmail` / `updateFailedLoginPg` / `resetFailedLoginPg` —— 给 `@agenticx/auth` 用
- `listAdminUsers` / `getAdminUser` / `createAdminUser` / `updateAdminUser` / `softDeleteUser`
- `resetUserPassword`
- `upsertUserRowFromAuthUser` / `assignRolesIfNone`
- `upsertUserByEmail` / `upsertUserByEmailInTx`
- `replaceUserRoleAssignments`

### `repos/departments.ts`
**职责**：每租户部门 / 组织树（PG 实现，MySQL 委托 `mysqlDeptsRepo`）

**类型**：`DepartmentRow`

**函数**：`getDefaultOrgId`、`listDepartmentsFlat`、`listDepartmentsTree`、`getDepartment`、`createDepartment`、`updateDepartmentName`、`moveDepartment`、`deleteDepartment`、`findOrCreateDepartmentPath`、`listDepartmentSubtreeIds`、`listDepartmentAncestorIds`

### `repos/roles.ts`
**职责**：系统 + 自定义角色、user↔role 分配、scope 聚合（PG 实现，MySQL 委托 `mysqlRolesRepo`）

**类型**：`RoleRow`

**函数**：`ensureSystemRoles`、`listRoles`、`getRoleById`、`getRoleByCode`、`createCustomRole`、`updateRole`、`deleteRole`、`duplicateRole`、`resolveRoleIdsFromCodes`、`listUsersForRole`、`aggregateScopesForUser`、`getUserRolesDetail`、`superAdminScopesFallback`

### `repos/sso-providers.ts`
**职责**：OIDC & SAML providers CRUD（re-export `SsoProviderProtocol`, `SsoProviderSamlConfig` 自 db-schema；PG 实现，MySQL 委托 `mysqlSsoRepository`）

**类型**：`SsoProviderDto`

**函数**：`listSsoProviders`、`getSsoProviderByProviderId`、`getSsoProviderById`、`findEnabledByProviderIdAndProtocol`、`createSsoProvider`、`createSamlProvider`、`updateSsoProvider`、`deleteSsoProvider`

### `repos/audit.ts`
**职责**：审计日志写入（通过 `AuditRepository` 抽象委托 `mysqlAuditRepository` 或 `postgresqlAuditRepository`）

**类型**：`AuditInsert`

**函数**：
- `sanitizeSsoAuditDetail` —— **从 SSO 事件中脱敏 PII**
- `insertAuditEvent` —— 接受可选 `IamDb`（支持事务复用）

## 特殊服务

### `provider-api-key-crypto.ts`
**信封加密** for 数据库中存储的 model provider 密钥

**格式**：`agx:gcm1:<iv_b64u>.<ciphertext_b64u>.<tag_b64u>`

**算法**：AES-256-GCM，密钥从 env `AGX_PROVIDER_SECRET_KEY` SHA-256 派生（生产必需；dev 有不安全 fallback）

**导出**：`encryptProviderApiKey` / `decryptProviderApiKey` —— 都优雅处理空 / legacy payload

### `runtime-legacy-migrate.ts`
**一次性磁盘 JSON → DB 迁移**（legacy on-disk config），按方言分支

**子函数**：`migrateLegacyProvidersIfNeeded` / `migrateLegacyUserVisibleModelsIfNeeded` / `migrateLegacyQuotasIfNeeded`

**编排**：`migrateRuntimeLegacyFromDisk` 在 `resolveRuntimeAdminDir(cwd)` 下读 legacy JSON

**类型**：`QuotaConfig` / `QuotaRule` / `QuotaAction`（其他地方也用）

### `pat-service.ts` + `pat-revocation-store.ts`
**Personal Access Token 全生命周期**（按方言分支）：
- `generatePatPlaintext`、`createPat`、`listPats`、`revokePat`
- `verifyPat`（返回 `VerifyPatResult`）
- `touchPatLastUsed`

**吊销**：`recordPatRevocation` / `recordPatRevocationByPlaintext` / `buildPatRevocationSnapshotForGateway`（gateway 5-10s 轮询拉哈希列表）

### `session-grant-service.ts`
**管理员签发的影子/扮演授权**（按方言分支）：
- `createSessionGrant` / `listSessionGrants` / `revokeSessionGrant`
- `buildSessionGrantsSnapshotForGateway`

### `compliance-service.ts`
**跨境数据政策 + 审计保留**（通过 `ComplianceStore` 抽象按方言派发）：
- 类型：`ComplianceConfig`、`CrossBorderAction`
- 函数：`getComplianceConfig`、`upsertComplianceConfig`、`getAuditRetentionCutoff`、`buildComplianceSnapshotForGateway`

### `quota-remaining.ts`
**计算 token 配额剩余**（按方言分支）：
- 类型：`QuotaUsageScope`、`QuotaRuleSnapshot`、`QuotaConfigSnapshot`、`RemainingUsage`、`QuotaSummary`
- 函数：`resolveRuntimeGatewayDir`、`loadQuotaConfigSnapshot`、`getQuotaUsageForScope`、`getQuotaSummaryForSession`

### `scope-registry.ts`
**静态 SCOPE_REGISTRY**（resource→verbs 映射）+ `ALL_REGISTERED_SCOPES`、`isRegisteredScope`、`expandRoleScopes`、`mergeUserScopes`、`hasEveryScope`、`hasSomeScope`

## 公共 API 表面（消费方）

根 barrel `@agenticx/iam-core` re-export 上述所有 repo/service 模块及 `db.ts` 的方言派发入口。`package.json#exports` 还显式暴露 3 个深路径：

| Entry point | 用途 |
|---|---|
| `@agenticx/iam-core` | web-portal / admin-console 的完整接口 |
| `@agenticx/iam-core/scope-registry` | 纯 scope 辅助（不依赖 DB） |
| `@agenticx/iam-core/provider-api-key-crypto` | 仅加解密 |
| `@agenticx/iam-core/runtime-legacy-migrate` | 部署脚本用的迁移 runner |

**Auth 契约实现**（通过 barrel 暴露）：
- `pg-auth-user-repository.ts` 现为 facade：MySQL 方言委托 `MysqlAuthUserRepository`，否则用 PG 仓库函数 —— 实现 `AuthUserRepository`
- `refresh-token-pg-store.ts` 现为 facade：按方言委托 `MysqlRefreshTokenStore` 或 `PostgresqlRefreshTokenStore` —— 实现 `RefreshTokenStore`

这两个 facade 就是 `@agenticx/auth` 接到 PG/MySQL 的方式。

## 测试布局

vitest，运行 `pnpm --filter @agenticx/iam-core test`：

| 文件 | 覆盖 |
|---|---|
| `src/__tests__/quota-remaining.test.ts` | 配额 config 加载 + per-scope 汇总 |
| `src/__tests__/runtime-legacy-migrate.test.ts` | legacy JSON → DB 迁移 |
| `src/repos/__tests__/sso-providers.test.ts` | SSO provider repo CRUD |

包根没有 mock DB 层；测试通过 `getRepositoryRegistry()` / `getIamDb()` 单例真打 Drizzle（`__resetDatabaseForTests` / `__resetIamDbForTests` 用于隔离）。

## 与 Enterprise 其他模块的关系

| 关联 | 形态 | 说明 |
|---|---|---|
| `packages/auth` | 实现其接口 | `pg-auth-user-repository` + `refresh-token-pg-store` 两个 facade 按 `DATABASE_DIALECT` 接 PG 或 MySQL，是 `@agenticx/auth` 接后端的方式 |
| `packages/db-schema` | 直接依赖 | repo 包 schema 表；PG 走 `@agenticx/db-schema` 主 schema，MySQL 走 `@agenticx/db-schema/mysql` |
| `apps/web-portal` | 主消费者 | session 加载、chat 数据访问 |
| `apps/admin-console` | 主消费者 | 所有 admin/* 数据 store；snapshot 生成 |
| `apps/gateway`（Go） | snapshot 消费者 | 通过 admin-console `/api/internal/*` 拉 PAT 吊销 / session grants / compliance snapshot；本包是 snapshot 的源头 |
