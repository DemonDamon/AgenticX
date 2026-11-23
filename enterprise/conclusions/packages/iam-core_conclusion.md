# @agenticx/iam-core 模块总结

> 结论生成时间：2026-11-14（基线 `cebdabd5`，覆盖当前代码 v0.1.0）

> 说明：本文档描述 **企业 IAM 与 Managed Agent 数据访问层包**（`@agenticx/iam-core`）。它是 web-portal + admin-console 共用的数据访问层，**同时支持 PostgreSQL 与 MySQL 两种方言**（基于 `@agenticx/db-schema` 的 Drizzle 双 schema）。

## 模块概述

`@agenticx/iam-core`（v0.1.0，workspace 包路径 `enterprise/packages/iam-core`，`package.json#description` 现为 "Enterprise IAM repositories (Drizzle, PostgreSQL / MySQL)"）是 AgenticX Enterprise IAM（Identity & Access Management）及 Managed Agent 控制面的**数据访问层**。它包装 `@agenticx/db-schema` 表（通过 Drizzle ORM），暴露**类型化的仓库函数**和少量**高层服务**（PAT、session grants、合规、配额、运行时配置迁移、Agent 版本、环境、凭据、记忆、调度、渠道与评测），并产出**供 gateway 推理时使用的 "snapshot" payloads**。

依赖：`@agenticx/auth`（认证契约）+ `@agenticx/core-api`（Agent manifest / managed eval 契约）+ `@agenticx/db-schema`（Drizzle 双 schema）+ `drizzle-orm` + `pg` + `mysql2` + `ulid`。测试用 `vitest`。

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
    ├── session-revocation-store.ts        # 用户会话撤销水位与 gateway snapshot
    ├── incident-response-primitives.ts    # PAT/用户/refresh session 事件响应原语
    ├── ma-vault-crypto.ts                 # Managed Agent 凭据的 DEK/KEK 信封加密
    ├── session-grant-service.ts           # 管理员签发的临时 session grants（按方言分支）
    ├── compliance-service.ts              # 跨境/审计保留合规配置（ComplianceStore 抽象，按方言分支）
    ├── quota-remaining.ts                 # 租户/部门/用户/PAT 配额剩余汇总（按方言分支）
    ├── repos/
    │   ├── contracts.ts                   # 方言中立接口，含 SecurityIncidentRepository
    │   ├── users.ts                       # PG 实现 + 委托 mysqlUsersRepository（MySQL）
    │   ├── departments.ts                # PG 实现 + 委托 mysqlDeptsRepo（MySQL）
    │   ├── roles.ts                      # PG 实现 + 委托 mysqlRolesRepo（MySQL）
    │   ├── sso-providers.ts              # PG 实现 + 委托 mysqlSsoRepository（MySQL）
    │   ├── audit.ts                      # 通过 AuditRepository 抽象委托 mysqlAuditRepository / postgresqlAuditRepository
    │   ├── agents.ts                     # 企业 Agent 注册表 + Managed Agent 路由/环境设置
    │   ├── agent-versions.ts             # 不可变 Agent manifest 版本、回填、预览与分页
    │   ├── agent-manifest-legacy.ts      # legacy 列 ↔ manifest 投影兼容
    │   ├── ma-environments.ts            # cloud / desktop_worker 执行环境
    │   ├── ma-vaults.ts                  # 凭据库、凭据解析与 OAuth refresh
    │   ├── ma-memory.ts                  # 记忆库、CAS 写入、版本、脱敏与 dream review
    │   ├── ma-schedules.ts               # cron 调度定义、手动触发与运行摘要
    │   ├── ma-webhooks.ts                # webhook、签名凭据与投递查询
    │   ├── ma-channels.ts                # 飞书渠道配置、连接态与会话查询
    │   ├── ma-agent-quotas.ts            # Agent 默认/用户级配额
    │   ├── ma-evals.ts                   # 评测集、用例与 rubric
    │   ├── ma-evals-read.ts              # eval run/result/candidate 只读查询
    │   ├── ma-sessions-read.ts           # session/event/work item 只读查询
    │   ├── incidents.ts                  # 安全事件三态状态机与动作明细
    │   ├── cases.ts                      # 企业案例库（enterprise_cases；状态机用 db-schema 的 canTransitionCase）
    │   ├── projects.ts                   # 管理台只读项目/协作房间视图（enterprise_projects + collab 表；可见性 SQL）
    │   ├── mysql/
    │   │   └── agents.ts                 # MySQL enterprise_agents 读写
    │   └── __tests__/
    │       ├── sso-providers.test.ts
    │       ├── agents-validate.test.ts
    │       └── projects.test.ts
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
定义 `DialectRepository`（带 `readonly dialect`）及 `AuditRepository`、`UsersRepository`、`DepartmentsRepository`、`RolesRepository`、`SsoProvidersRepository`、`SecurityIncidentRepository`。PG 与 MySQL 实现都遵守这些接口；安全事件契约覆盖事件 CRUD、状态迁移与处置动作明细。

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

### `repos/agents.ts`
**职责**：租户级企业 Agent 注册表及 Managed Agent 运行设置，读写 `enterprise_agents`，并把 legacy 字段与不可变 manifest 版本链保持兼容。

**类型**：`EnterpriseAgent`、`AgentInput`、`EnterpriseAgentWithMa`、`AgentMaSettingsPatch`；枚举 `AgentRuntime` / `AgentStatus` / `AgentLifecycle` / `AgentOrigin` / `AgentVersionRouting`

**校验**：`validateAgentInput`（slug、模型、最长 65536 字符 system prompt、runtime/status/lifecycle/origin、能力 id `mcp|skill:` ULID/Base32、`assignmentKeys` 非空、`metadata.knowledgeSearchUrl` 仅 http/https）；能力 id 是否已登记 Skill/MCP **不在本包**校验

**错误类**：`AgentValidationError`、`AgentNotFoundError`、`AgentSlugConflictError`、`AgentHasSessionsError`

**函数**：原 CRUD 外新增 `listAgentsWithMa` / `getAgentWithMa`、`updateAgentMaSettings`（`follow_latest` / `pinned` + 默认环境校验）、`createAgentWithInitialVersion`；已有 `registerEmployeeAgent`、`listAgentsVisibleToKeys`、`isVisibleToEmployees` 保持。

### `repos/cases.ts`
**职责**：企业案例库，读写 `enterprise_cases`（PG / MySQL 双方言，`resolveDatabaseConfig` + `getIamDb` / `createMysqlDb`）

**类型**：`EnterpriseCase`；错误 `CaseNotFoundError`、`CaseTransitionError`

**函数**：`listEnterpriseCases`（可选 `status` / `submitterUserId`）、`getEnterpriseCase`、`createEnterpriseCase`（初始 `submitted`）、`transitionEnterpriseCase`（委托 `@agenticx/db-schema` 的 `canTransitionCase` / `isCaseStatus`）

### `repos/projects.ts`
**职责**：管理台**只读**项目与协作数据聚合（`enterprise_projects`、`enterprise_collab_rooms`、`enterprise_collab_room_members`、`enterprise_collab_room_messages`，联表 `users` / `departments`；PG 与 MySQL 共用 `adminProjectScopeSql`）

**可见性**：`ProjectVisibility` — `all` / `dept`（按 `dept_id`）/ `self`（主房间 human 成员 EXISTS 子查询）；列表在 SQL 与结果层双重过滤；`dept`/`self` 模式可读 direct 房间元数据但 **`listAdminProjectMessages` 对 direct 抛 `ProjectForbiddenError`**，`all` 可读

**导出**：`listAdminProjects`、`getAdminProject`、`listAdminProjectMessages`；`adminProjectScopeSql` 供测试编译 SQL；`__setAdminProjectsFixtureForTests` 内存 fixture 供单测

## Managed Agent 控制面仓库

以下模块均从根 barrel 导出；除纯校验/规划器外，公开仓库按 `resolveDatabaseConfig()` 派发 PostgreSQL / MySQL：

- **Agent manifest 版本**：`agent-versions.ts` 提供 `ensureAgentVersionOne`、`createAgentVersion`、`previewAgentManifest`、`getAgentVersion`、`listAgentVersions`、`backfillAgentVersions`。版本只追加、不暴露更新/删除接口；`expectedLatestVersion` 做乐观并发控制，内容 hash 未变化时不重复写入。`agent-manifest-legacy.ts` 负责 legacy 列投影、租户 skill 版本固定及 multiagent 成员版本固定。
- **执行环境与只读运行视图**：`ma-environments.ts` 管理 `cloud` / `desktop_worker` 环境，删除前检查 Agent、活跃 session 和开放 work item 引用；`ma-sessions-read.ts` 仅提供 session、event、work item 查询，不提供写接口。
- **凭据与渠道**：`ma-vaults.ts` 管理 vault/credential 生命周期、引用检查、运行时 bundle 解析与 MCP OAuth refresh；`ma-vault-validate.ts` 对 `static_bearer`、`mcp_oauth`、`bearer`、`environment_variable` 四类凭据执行 URL/host/secret/networking 严格校验。`ma-channels.ts` 管理飞书渠道、版本路由、连接态和渠道会话，并经 vault 解析 app secret；审计详情不包含明文 secret。
- **记忆**：`ma-memory-path.ts` 定义绝对 NFC 路径、单项 100 KiB、单库 2000 项 / 20 MiB 上限和 `planMemoryWrite` CAS 规划；`ma-memory.ts` 管理 store、分页/折叠读取、版本历史、非 head 版本脱敏、审计及 dream 输出审核门禁；`ma-memory-dreams-read.ts` 只读 dream 运行记录。
- **调度与 webhook**：`ma-cron.ts` 校验五段 cron（每小时最多触发 12 次）和 IANA 时区；`ma-schedules.ts` 管理版本策略、环境、vault、memory 资源、手动触发及 run 摘要；`ma-webhooks.ts` 管理事件订阅、签名凭据轮换/撤销和投递查询。
- **配额与评测**：`ma-agent-quotas.ts` 提供 Agent 默认/用户级 token、费用、并发限制的 upsert 与有效配额解析；`ma-evals.ts` 管理最多 500 条用例的评测集及版本化 rubric（通过 `@agenticx/core-api/managed-evals` 校验）；`ma-evals-read.ts` 只读 run、result、candidate。
- **安全事件**：`incidents.ts` 提供 `open → handling → resolved` 三态事件状态机和处置动作明细，`getSecurityIncidentRepository` 按方言返回实现；`SecurityIncidentRepository` 是其方言中立契约。

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

### `session-revocation-store.ts` + `incident-response-primitives.ts`
- `recordSessionRevocation` / `buildSessionRevocationSnapshotForGateway` 按用户记录会话撤销水位并生成 gateway snapshot；MySQL 实现位于 `repos/mysql/session-revocation.ts`。
- `getPatHash`、`listUserSessionIds`、`setUserStatusDisabled`、`deleteRefreshSessionBySessionId` 是事件响应编排使用的低层原语。

### `ma-vault-crypto.ts`
Managed Agent secret 使用随机 DEK + AES-256-GCM 加密 payload，再用 `MA_VAULT_MASTER_KEY` 派生 KEK 包装 DEK；`MA_VAULT_MASTER_KEY_PREVIOUS` 支持主密钥轮换后的解密回退。缺失/弱密钥抛 `VaultCryptoUnavailableError`，认证失败抛 `VaultDecryptError`。

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
- 类型：`QuotaUsageScope`、`QuotaRuleSnapshot`、`QuotaConfigSnapshot`、`RemainingUsage`、`QuotaSummary`、`UsageRecordSlice`、`QuotaWindowUsageTotals`
- 函数：`resolveRuntimeGatewayDir`、`loadQuotaConfigSnapshot`、`getQuotaUsageForScope`、`getQuotaWindowUsageForScope`、`getQuotaSummaryForSession`
- **批量用量**：`getQuotaWindowUsagesForUsers` — 多成员 day/week/month 的 token 与 `costUsd`；无 `DATABASE_URL` 或 `recordsOverride` 时走 `foldUsageRecordSlices`；否则按方言对 `usage_records`（PG `@agenticx/db-schema` / MySQL `@agenticx/db-schema/mysql`）分组聚合（每 chunk 100 个 userId，`time_bucket >=` 当月起点）；辅助 `usageWindowStart`、`foldUsageRecordSlices`
- 周期字符串辅助（`currentPeriod` / `periodForWindow` 等）支持可选 `now` 参数便于测试

### `scope-registry.ts`
**静态 SCOPE_REGISTRY**（resource→verbs 映射）+ `ALL_REGISTERED_SCOPES`、`isRegisteredScope`、`expandRoleScopes`、`mergeUserScopes`、`hasEveryScope`、`hasSomeScope`

## 公共 API 表面（消费方）

根 barrel `@agenticx/iam-core` re-export 上述 repo/service 模块、Managed Agent 控制面仓库及 `db.ts` 的方言派发入口。`package.json#exports` 还显式暴露 3 个深路径：

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
| `src/__tests__/quota-remaining.test.ts` | 配额 config 加载 + per-scope 汇总 + `getQuotaWindowUsagesForUsers` 多用户多窗口 |
| `src/__tests__/runtime-legacy-migrate.test.ts` | legacy JSON → DB 迁移 |
| `src/repos/__tests__/sso-providers.test.ts` | SSO provider repo CRUD |
| `src/repos/__tests__/agents-validate.test.ts` | `validateAgentInput` / `isVisibleToEmployees`（无 DB） |
| `src/repos/__tests__/projects.test.ts` | 项目可见性 fixture + PG/MySQL `adminProjectScopeSql` 编译 |
| `src/repos/__tests__/agent-versions.test.ts`、`agent-manifest-legacy.test.ts` | manifest 回填/追加、并发冲突、skill/member 固定、legacy 投影 |
| `src/repos/__tests__/ma-memory-*.test.ts` | 路径/容量限制、CAS、版本脱敏、删除前置条件、dream review |
| `src/repos/__tests__/ma-vault-*.test.ts`、`src/__tests__/ma-vault-crypto.test.ts` | 凭据校验、信封加密/轮换、OAuth refresh、运行时 bundle |
| `src/repos/__tests__/ma-*.test.ts` | 环境、cron/调度、渠道、webhook、Agent 配额、eval、session 只读映射 |
| `src/repos/__tests__/incidents.test.ts` | 安全事件状态机、方言派发与行映射 |

包根没有统一 mock DB 层；部分单测使用模块内存适配器（如 Agent 版本与 eval），其余通过方言仓库或纯校验器隔离。

## 与 Enterprise 其他模块的关系

| 关联 | 形态 | 说明 |
|---|---|---|
| `packages/auth` | 实现其接口 | `pg-auth-user-repository` + `refresh-token-pg-store` 两个 facade 按 `DATABASE_DIALECT` 接 PG 或 MySQL，是 `@agenticx/auth` 接后端的方式 |
| `packages/core-api` | 复用契约 | Agent manifest 规范化/hash 与 managed eval rubric 校验 |
| `packages/db-schema` | 直接依赖 | repo 包 schema 表；PG 走 `@agenticx/db-schema` 主 schema，MySQL 走 `@agenticx/db-schema/mysql` |
| `apps/web-portal` | 主消费者 | session 加载、chat 数据访问 |
| `apps/admin-console` | 主消费者 | 所有 admin/* 数据 store；snapshot 生成 |
| `apps/gateway`（Go） | snapshot 消费者 | 通过 admin-console `/api/internal/*` 拉 PAT / session 吊销、session grants、compliance snapshot；本包是 snapshot 的源头 |
