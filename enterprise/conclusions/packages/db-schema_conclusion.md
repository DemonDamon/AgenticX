# AgenticX Enterprise db-schema 模块总结

> 结论生成时间：2026-07-21（重新生成，覆盖当前代码 v0.1.0）

> 说明：本文档描述 **企业多租户平台的 Drizzle ORM 数据库 schema 包**（`@agenticx/db-schema`），是 admin-console、web-portal、auth、iam-core 共享的唯一 Schema 源头。**当前代码同时定义 PostgreSQL 与 MySQL 两套 schema**，并各自维护独立的迁移链。以 `schema-parity.test.ts` 为准：双方言共 **73** 张表；`runtime-config.ts` 内 **15** 张运行时/认证相关表；PG journal **60** 条（最高 tag `0060_enterprise_feature_usage`），磁盘 **62** 个 `.sql`（含 **2** 个已知 orphan，`0025` 在 journal 中仍缺号）；MySQL journal **35** 条（`0000` baseline + `0001`…`0034`），baseline 仍一次性建 **42** 张表 + 1 VIEW，增量迁移与 PG 对齐补表/改列。

## 模块概述

`@agenticx/db-schema`（v0.1.0，workspace 包路径 `enterprise/packages/db-schema`，`package.json#description` 为 "Drizzle schema（多租户字段预留）"）是 AgenticX Enterprise 多租户平台的**唯一规范 Drizzle ORM schema**。它定义了 IAM、Chat、Metering、Audit、Billing、Policy、MCP、Gateway 运行时配置、SSO 等所有业务域的表，**同时提供 PostgreSQL 与 MySQL 两套等价 schema**，并各自附带由 `drizzle-kit` 生成的版本化 SQL 迁移脚本。所有上层 app/package（admin-console / web-portal / iam-core / auth）都通过 `import { ... } from "@agenticx/db-schema"`（或 `@agenticx/db-schema/mysql`）引用这里定义的表与行类型。

依赖：`drizzle-orm` ^0.45.2 + `pg` ^8.20 + `mysql2` ^3.14 + `bcryptjs`。dev：`drizzle-kit` ^0.31.10、`vitest` ^4.1.5、`typescript` ^5.9.2。

## 目录结构

```
packages/db-schema/
├── README.md                        # 占位
├── package.json                     # exports: . / ./postgres / ./mysql / ./dialect / ./contracts
├── drizzle.config.ts                # 已弃用，re-export drizzle.pg.config.ts
├── drizzle.pg.config.ts             # dialect=postgresql, schema=./src/schema/index.ts, out=./drizzle
├── drizzle.mysql.config.ts          # dialect=mysql, schema=./src/mysql-schema/index.ts, out=./drizzle-mysql
├── tsconfig.json
├── scripts/
│   ├── db-seed.mjs / db-seed-dispatch.mjs / db-seed-mysql.mjs   # 基础 seed（PG/MySQL 分发）
│   ├── iam-demo-seed.mjs            # IAM demo 数据
│   ├── pg-seed-client-config.mjs    # 客户配置 seed
│   └── db-migrate.mjs               # 迁移执行入口
├── drizzle/                         # 生成的 PG SQL 迁移（62 个 .sql + meta/）
│   ├── 0000_friendly_rictor.sql … 0060_enterprise_feature_usage.sql
│   └── meta/                        # snapshot + _journal.json（60 条 entry）
├── drizzle-mysql/                   # 生成的 MySQL SQL 迁移（35 个 .sql + meta/）
│   ├── 0000_mysql_baseline.sql … 0034_enterprise_feature_usage.sql
│   └── meta/                        # _journal.json（35 条 entry）
└── src/
    ├── index.ts                     # export schema + case-status + store-zip + dialect; export * as postgres / mysql
    ├── case-status.ts               # 案例库状态机与包路径辅助（非 Drizzle 表）
    ├── store-zip.ts                 # STORE 法 ZIP 读取（案例预览）
    ├── dialect.ts                   # DATABASE_DIALECTS / DatabaseDialect / inferDialectFromUrl / resolveDatabaseDialect
    ├── postgres.ts                  # re-export src/schema + src/dialect
    ├── mysql.ts                     # re-export src/mysql-schema + src/dialect
    ├── contracts/
    │   └── index.ts                 # 方言中立 DTO（Tenant/Department/User/Role/ChatSession/ChatMessage/AuditEvent/UsageRecord）
    ├── schema/                      # PostgreSQL 定义（43 文件 = 41 域 + index + _shared）
    │   ├── index.ts                 # barrel：re-export 全部 41 个域文件
    │   ├── _shared.ts               # ulid / auditColumns(timestamptz) / softDeleteColumns / nowTimestamp
    │   ├── tenants.ts / organizations.ts / departments.ts / users.ts
    │   ├── roles.ts / user-roles.ts / api-tokens.ts / sso-providers.ts
    │   ├── chat-sessions.ts / chat-messages.ts
    │   ├── usage-records.ts / agent-token-traces.ts
    │   ├── audit-events.ts / gateway-audit-events.ts
    │   ├── policy.ts
    │   ├── runtime-config.ts        # ⚡ 15 张运行时/认证表（含 web-search、scope 默认模型、desktop agent policy）
    │   ├── gateway-channels.ts / gateway-budget.ts / connector-gateway.ts
    │   ├── mcp-servers.ts / mcp-tools.ts
    │   ├── agents.ts / agent-tasks.ts / case-library.ts / collab-projects.ts
    │   ├── chat-message-feedback.ts / feature-usage.ts
    │   ├── business-revenue.ts / billing-split.ts
    │   └── quota-pool.ts / quota-plans.ts
    ├── mysql-schema/                # MySQL 定义（43 文件，与 PG 镜像）
    │   ├── index.ts / _shared.ts    # _shared 用 datetime(6) + UTC_TIMESTAMP(6)
    │   └── （与 schema/ 同名的 41 个域文件）
    └── __tests__/
        ├── schema-parity.test.ts            # 校验 MySQL 镜像全部 73 张 PG 表
        ├── migration-inventory.test.ts      # 校验 PG/MySQL journal 与 orphan 规则
        ├── case-status.test.ts / store-zip.test.ts
```

## 双方言与方言解析（`dialect.ts`）

- `DATABASE_DIALECTS = ["postgresql", "mysql"] as const`；`DatabaseDialect` 类型
- `inferDialectFromUrl`：`postgres(ql)://` → postgresql，`mysql://` → mysql
- `resolveDatabaseDialect({dialect, databaseUrl})`：dialect 必填或可由 URL 推断；URL scheme 必须与 dialect 交叉一致（不一致抛错）；dialect=postgresql 要求 `postgres(ql)://`，dialect=mysql 要求 `mysql://`
- `isDatabaseDialect` 类型守卫

## 方言中立契约（`contracts/index.ts`）

明示「**never derive public contracts from `$inferSelect`**」。定义 8 个 DTO：`Tenant`、`Department`、`User`、`Role`、`ChatSession`、`ChatMessage`、`AuditEvent`、`UsageRecord`，并各给 `*Dto` 别名。这些 DTO 让上层 API 在 PG/MySQL 之间保持稳定形状。

## 共享辅助（`_shared.ts`）

| 辅助 | PostgreSQL (`schema/_shared.ts`) | MySQL (`mysql-schema/_shared.ts`) |
|---|---|---|
| `ulid(name)` | `varchar(26)` | `varchar(26)` |
| `auditColumns` | `created_at`/`updated_at` `timestamptz` `defaultNow` | `datetime(6)` 默认 `(UTC_TIMESTAMP(6))` |
| `softDeleteColumns` | `is_deleted` boolean + `deleted_at` timestamptz | `is_deleted` boolean + `deleted_at` `datetime(6)` |
| `nowTimestamp` | `now()` | `(UTC_TIMESTAMP(6))` |

## 表清单（按业务域）

### IAM / 组织树

| 表 | 关键设计 |
|---|---|
| `tenants` | 根；`code` 唯一；`plan` 默认 `enterprise` |
| `organizations` | FK→tenants；uq (tenant, name) |
| `departments` | FK→org+tenant；自引 `parent_id`；uq (tenant, path) 物化路径 |
| `users` | FK→tenant+dept；soft-delete；`failed_login_count` + `locked_until`；partial unique index `users_tenant_email_active_uq`（仅活跃用户） |
| `roles` | 租户级；`scopes` jsonb；`immutable` 标识 |
| `user_roles` | 复合 PK (tenantId, userId, roleId)；可选 `scope_org_id` / `scope_dept_id` 字段级授权 |
| `api_tokens` | bigint identity PK；网关 M2M 用 PAT；`token_hash` 唯一；`token_prefix` 显示前缀 |
| `sso_providers` | OIDC + SAML 统一；`claim_mapping`、`saml_config`、`default_role_codes` 均 jsonb |

### Chat

| 表 | 关键设计 |
|---|---|
| `chat_sessions` | 复合 FK→user+tenant；`active_model`、`message_count`；`deleted_at` 软删 |
| `chat_messages` | 复合 FK→session+tenant+user；CHECK role∈{system,user,assistant,tool}；status∈{complete,streaming,failed} |
| `chat_message_feedback` | 用户对 assistant 消息 like/dislike；`source`∈{web,desktop}，CHECK 约束 web 必绑 session+message、desktop 必绑 external_*；可选 trace/provider/model 快照 |

### Metering / Trace

| 表 | 关键设计 |
|---|---|
| `usage_records` | 每次调用的 cost/token 汇总；`numeric(20,0)` token 字段（含 cache/reasoning 拆分）；`cost_usd`、`pricing_version`、`trace_id` |
| `agent_token_traces` | per-step LLM trace；uq (tenant, trace_id, step_no) |

### Audit

| 表 | 关键设计 |
|---|---|
| `audit_events` | IAM / admin 事件；jsonb `detail`；index on (tenant, target_kind, target_id) |
| `gateway_audit_events` | LLM / policy 事件；**append-only 防篡改**：`prev_checksum` + `checksum` + `checksum_version` + `checksum_payload` + `signature` 哈希链；跨境字段；MCP 执行字段；连接器维度 `connector_execution_id` / `connector_action_id` / `connector_connection_id`；GIN index on `policies_hit` |

### Policy

| 表 | 关键设计 |
|---|---|
| `policy_rule_packs` | jsonb `applies_to`（dept / role / user / clientType / stages 目标） |
| `policy_rules` | per-pack；`kind` / `action` / `severity` / `payload`；`status`（draft / published） |
| `policy_rule_versions` | uq (tenant, rule, version) 快照历史 |
| `policy_publish_events` | 租户范围的已发布快照版本 |

### Billing

| 表 | 关键设计 |
|---|---|
| `enterprise_business_revenue` | 场景打标的营收汇总；numeric(18,8) USD |
| `billing_split_rules` | jsonb `participants` / `billing_items`；effective-window；`split_mode` |
| `billing_split_ledger` | per-usage 分账分录；`amount_micro_usd` bigint；uq (usage, participant, rule) |
| `billing_settlement_webhook_config` | per-tenant webhook URL |
| `billing_settlement_webhook_events` | 投递日志 |

### MCP

| 表 | 关键设计 |
|---|---|
| `mcp_servers` | 租户级 MCP server 注册表；`transport` 默认 streamable-http；`backend_type` + `backend_config`；`required_scopes` text[] |
| `mcp_tools` | FK→mcp_servers；uq (server, tool_name)；jsonb `input_schema` / `output_schema` |

### Connector Gateway（`connector-gateway.ts`）

| 表 | 关键设计 |
|---|---|
| `connector_definitions` | 复合 PK (tenant_id, connector_id)；jsonb `definition`；租户级连接器目录 |
| `connector_connections` | 命名连接实例；`auth_type` + `granted_scopes` jsonb；`encrypted_secret` 密文 |

### Enterprise Agents / 桌面任务（`agents.ts` / `agent-tasks.ts`）

| 表 | 关键设计 |
|---|---|
| `enterprise_agents` | 租户 Agent 注册；slug uq；`model`（provider/model）；`runtime` cloud/desktop_worker；capability/assignment/worker keys 数组；`status` / `lifecycle` / `origin`；可选 owner + local_avatar uq |
| `enterprise_agent_workers` | 桌面 Worker 心跳；uq (agent, user, device) |
| `enterprise_agent_tasks` | 协作房间触发的任务队列；租约 `lease_expires_at`；status/attempts/result_message_id |

### 案例库（`case-library.ts`）

| 表 | 关键设计 |
|---|---|
| `enterprise_cases` | 提交→审核→归档→发布；`manifest` jsonb + `package_path`；状态 submitted/reviewing/archived/published（逻辑见 `case-status.ts`） |

### 协作项目 / 房间（`collab-projects.ts` / `collab-rooms.ts`）

| 表 | 关键设计 |
|---|---|
| `enterprise_projects` | 租户项目；owner FK→users；`settings` jsonb（connectors/experts/skills）；`main_room_id` |
| `enterprise_collab_rooms` | 房间；可选 `project_id`；`parent_room_id` + `room_kind`（默认 room） |
| `enterprise_collab_room_members` / `enterprise_collab_room_messages` | 成员与 seq 消息；消息可选 `client_msg_id` uq (room, client_msg_id) |

### 计量特性用量（`feature-usage.ts`）

| 表 | 关键设计 |
|---|---|
| `enterprise_feature_usage_daily` | 按用户 UTC 日计数；feature 如 search_provider_calls / deep_research_runs |
| `enterprise_feature_usage_shared_daily` | 公司/部门共享日计数；scope + scope_id |

### Gateway 预算台账（`gateway-budget.ts`）

| 表 | 关键设计 |
|---|---|
| `gateway_budget_usage` | 多维度（company/org/dept/personal）周期用量；numeric used_value |
| `gateway_budget_reservations` | receipt 幂等预占/结算；`lines_json` + actual_tokens/cost |

### Gateway 运行时（`runtime-config.ts`，共 15 张表）

| 表 | 关键设计 |
|---|---|
| `enterprise_runtime_model_providers` | per-tenant provider 配置；`api_key_cipher` AES-256-GCM；uq (tenant, provider) |
| `enterprise_runtime_user_visible_models` | PK (tenant, assignment_key, model_id) 可见性映射 |
| `enterprise_runtime_scope_default_models` | PK (tenant, assignment_key)；部门默认模型（assignment_key 仅 `dept:<id>`） |
| `enterprise_runtime_token_quotas` | 一行一租户的 jsonb 配置 |
| `enterprise_runtime_policy_snapshots` | 已发布 policy JSON，每租户一行 |
| `enterprise_runtime_pricing` | 动态计价配置 |
| `enterprise_runtime_budgets` | cost / token 预算配置 |
| `gateway_budget_alerts` | admin 只读的 warn / 熔断事件 |
| `session_grants` | TTL 会话级 scope 授权（agent 协作） |
| `enterprise_runtime_pat_revocation` | 版本化哈希列表，供 PAT 吊销拉取 |
| `enterprise_runtime_compliance` | 数据驻留、跨境策略、审计保留年数；append-only |
| `enterprise_runtime_mcp_servers` | MCP 反向代理配置 bundle |
| `enterprise_runtime_web_search` | 联网搜索开关/provider/密钥密文/deep_research 开关 |
| `enterprise_desktop_agent_policies` | 租户桌面 Agent 动作策略 JSON（与 budgets 分表，避免整包覆盖丢失） |
| `auth_refresh_sessions` | 无服务器 refresh token sessions |

> 另有 `gateway_channels`、`gateway_budget_*`（上表）、`gateway_quota_pool_usage` + `gateway_quota_ledger`、`enterprise_quota_plans` + `enterprise_quota_plan_assignments`，以及 chat/collab/capability 等域文件中的表，合计全包 **73 张表**（由 `schema-parity.test.ts` 校验 MySQL 镜像一致）。

## 关键约定

| 约定 | 实现 |
|---|---|
| **主键 ID** | ULID（`varchar(26)`）通过 `ulid(name)` 辅助；`api_tokens` 用 bigint identity；`gateway_budget_alerts` / `session_grants` 用 `varchar(64)` |
| **租户隔离** | `tenant_id` 几乎在每张表上（旧表 FK→`tenants.id`，新运行时表用未强约束的 `varchar(26)`）；复合索引总是以 `tenant_id` 开头 |
| **审计列** | `auditColumns` = `created_at` + `updated_at`（PG timestamptz / MySQL datetime(6)，defaultNow，notNull）；部分运行时表只带其中之一 |
| **软删除** | `softDeleteColumns`（`is_deleted` boolean + `deleted_at`）用于 `users`；`chat_sessions` 只用 `deleted_at` |
| **加密** | `api_key_cipher` / `client_secret_encrypted` 是 AES-256-GCM 密文列——**永不持久化明文密钥** |
| **复合 FK** | `chat_messages` / `chat_sessions` 用多列 FK 强制 tenant+user 一致性 |
| **哈希链审计** | `gateway_audit_events` 的 `prev_checksum` / `checksum` / `checksum_payload` / `signature` 实现防篡改链；compliance 表带 `append_only` flag |
| **JSONB-first 配置** | 运行时配置表（policy snapshots / budgets / pricing / mcp servers / quotas）整 bundle 存 jsonb（MySQL 侧用 `json`），按 `tenant_id` 寻址 |

## 迁移

### PostgreSQL（`drizzle/`，`drizzle.pg.config.ts`）
- **工具**：`drizzle-kit` ^0.31.10；`out: ./drizzle`；`dialect: postgresql`；schema `src/schema/index.ts`
- **Journal**：`drizzle/meta/_journal.json` 含 **60 条** entry（idx 0–59），末 tag `0060_enterprise_feature_usage`；**`0025` 在 journal 中仍缺号**；最近一批 `0050_enterprise_scope_default_models` … `0060_enterprise_feature_usage`
- **磁盘 SQL**：**62 个** `.sql` 文件，其中 60 个被 journal 跟踪，另 **2 个 orphan** 不在 journal：`0016_mcp_hosting.sql`、`0025_enterprise_runtime_mcp_servers.sql`
- **脚本**：`db:generate:pg`、`db:migrate:pg`、`db:seed:pg`

### MySQL（`drizzle-mysql/`，`drizzle.mysql.config.ts`）
- **工具**：`drizzle-kit`；`out: ./drizzle-mysql`；`dialect: mysql`；schema `src/mysql-schema/index.ts`
- **Journal**：`drizzle-mysql/meta/_journal.json` 含 **35 条** entry（idx 0–34），末 tag `0034_enterprise_feature_usage`；与 PG 同批增量 `0024`…`0034` 对齐 connector/agents/cases/projects/feedback/budget/feature-usage
- **Baseline**：`0000_mysql_baseline.sql` 一次性建 **42 张表 + 1 个 VIEW**（历史快照；其后靠增量迁移追平至 73 表）
- **Orphan 规则**：`migration-inventory.test.ts` **明确禁止**把 PG 的 orphan SQL 文件（`0016_mcp_hosting.sql`、`0025_enterprise_runtime_mcp_servers.sql`）移植进 MySQL 迁移链
- **脚本**：`db:generate:mysql`、`db:migrate:mysql`、`db:seed:mysql`

### 一致性校验
- `db:check:parity`（`schema-parity.test.ts`）：确认 MySQL 镜像全部 **73 张** PG 表，并保持逻辑列、可空性、数据类型对齐
- `migration-inventory.test.ts`：确认 PG journal **60** 条、磁盘 **62** 个 SQL 含 2 个已知 orphan；MySQL journal **35** 条且不含 PG orphan 文件名

### 通用
- **环境**：`DATABASE_URL` + `DATABASE_DIALECT`（参见 `dialect.ts`）；非 prod 下 PG 默认 `postgresql://postgres:postgres@127.0.0.1:5432/agenticx`
- 旧 `drizzle.config.ts` 已弃用，仅 re-export `drizzle.pg.config.ts`

## 导出 (`src/index.ts`)

```ts
export * from "./schema";
export * from "./case-status";
export * from "./store-zip";
export * from "./dialect";
export * as postgres from "./postgres";
export * as mysql from "./mysql";
```

`package.json#exports` 显式暴露 5 个入口：`.`、`./postgres`、`./mysql`、`./dialect`、`./contracts`。

`src/schema/index.ts` barrel re-export 全部 **41** 个 PG 域文件；`src/mysql-schema/index.ts` 平行 re-export。每个 schema 文件导出其 `pgTable`/`mysqlTable` 常量 + `$inferSelect` / `$inferInsert` 行类型，例如：
- `Tenant` / `NewTenant`
- `User` / `NewUser`
- `ChatSessionRow` / `NewChatSessionRow`
- `GatewayChannelRow`
- `McpServerRow`
- `PolicyRuleRow`
- ...

`_shared.ts` 中的辅助（`ulid`、`auditColumns`、`softDeleteColumns`、`nowTimestamp`）也透传导出。`contracts/index.ts` 导出 8 个方言中立 DTO 供上层 API 稳定消费。

## 与 Enterprise 其他模块的关系

| 关联 | 形态 | 说明 |
|---|---|---|
| `packages/iam-core` | 直接 import schema | PG 走主 schema（`pgSchema` 取 23 张 IAM/runtime 子集），MySQL 走 `@agenticx/db-schema/mysql` 全量；在此 schema 上建仓库层 |
| `packages/auth` | 直接 import schema | refresh token sessions、SSO provider 配置 |
| `apps/admin-console` | 直接 import schema | 所有 admin/* 数据 store 用此 schema |
| `apps/web-portal` | 直接 import schema | chat 数据、quota 数据、PAT |
| `apps/gateway` | **无直接 import**（Go） | 通过 admin-console `/api/internal/*` snapshot 端点间接消费；但底层 PG/MySQL 表是同一份 |
| `apps/edge-agent` | **无直接 import**（Go） | 通过 HTTP 上送 trace；admin-console 写入 `agent_token_traces` |
| `drizzle-kit` 迁移产物 | 部署时执行 | `bootstrap.sh` / `start-dev.sh` 调 `db:migrate:pg` / `db:migrate:mysql` |

## 与主仓 AgenticX 的对比

- 主仓 `agenticx` 框架无独立的 SQL schema 包；存储后端通过 `agenticx/storage` 抽象（多后端：文件 / Redis / Postgres / SQLite），schema 由各业务方自带
- 本包是 **Enterprise 专用**的一套生产级双方言（PostgreSQL + MySQL）Drizzle schema，承载企业平台业务事实，并通过 `contracts/` 提供方言中立 DTO


## 增量（30e57496 → 22d051f5）

双方言同步新增域文件并写入 `src/schema/index.ts` / `mysql-schema/index.ts`：

- `connector-gateway`、`gateway-budget`、`agents`、`agent-tasks`、`case-library`、`collab-projects`、`chat-message-feedback`、`feature-usage`
- `collab-rooms`：`project_id` / `parent_room_id` / `room_kind`；消息 `client_msg_id` 唯一约束
- `gateway-audit-events`：连接器审计三列
- `runtime-config`：`enterprise_runtime_scope_default_models`、`enterprise_desktop_agent_policies`（`enterprise_runtime_web_search` 等仍在同文件）

包根导出：`src/index.ts` 新增 `case-status`（案例状态机、`casePackageFile`）、`store-zip`（STORE ZIP 预览）。

**PG 迁移**（journal +11，共 60 条）：`0050_enterprise_scope_default_models` … `0060_enterprise_feature_usage`。

**MySQL 迁移**（journal +11，共 35 条）：`0024_enterprise_scope_default_models` … `0034_enterprise_feature_usage`（tag 序号与 PG 不同步属既有约定）。

**表规模**：`schema-parity.test.ts` 自 **59** 升至 **73** 张；`migration-inventory.test.ts` 同步 PG 60/62 与 MySQL 35 条 journal 断言。
