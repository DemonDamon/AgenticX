# @agenticx/feature-audit 模块总结

> 结论重新生成时间：2026-07-21（基于 `enterprise/features/audit` 源码逐文件核对）

> 说明：本文档描述 **审计日志 feature 包** `@agenticx/feature-audit`，由 `apps/admin-console` 的 `/audit` 页面消费。核心职责是 **PG/MySQL 审计查询 + CSV 导出 + blake2b 链校验**，读 `gateway_audit_events` 表（与 IAM `audit_events` 分表）。本文诚实区分"已落地"与"远期/缺口"。

## 模块概述

`@agenticx/feature-audit` v0.1.0 是 admin-console **审计日志查询/导出能力包**。把"存储"抽象成 `AuditStore` 接口（`query` / `exportCsv`），提供三种实现：**`PgAuditStore`**（生产主路径，读 PG `gateway_audit_events`）、**`MysqlAuditStore`**（MySQL 方言同构实现）、**`LocalAuditStore`**（本地 jsonl 回退，开发环境用）。`createAuditStore()` 工厂按 `resolveDatabaseConfig().dialect`（`postgresql` | `mysql`，exhaustive `never` 兜底）选实现。审计事件字段/类型来自 `@agenticx/core-api`，本包只做"查询 / 可见性 / 导出 / 链校验"侧，**不写审计事件**（写入由 Go Gateway 负责）。

## 目录结构（实际源码）

```
features/audit/
├── package.json                              # @agenticx/feature-audit（deps: core-api / db-schema / iam-core / drizzle-orm / mysql2 / ulid）
├── README.md                                  # 设计文档（含远期 ClickHouse / OTel / Ed25519 规划）
└── src/
    ├── index.ts                               # barrel（re-export PgAuditStore / MysqlAuditStore / LocalAuditStore / factory / AuditApi / types）
    ├── types.ts                               # AuditActor + AuditStore 接口 + 透传 core-api 类型
    ├── api/audit.ts                           # AuditApi（{code,message,data} JSON 信封包装）
    └── services/
        ├── factory.ts                         # createAuditStore()：按 dialect 选 Pg / Mysql
        ├── pg-store.ts                        # PgAuditStore + verifyGatewayAuditChain + insertGatewayAuditExportEvent
        ├── mysql-store.ts                     # MysqlAuditStore（与 PG 同构，JSON_CONTAINS 替代 jsonb @>）
        ├── mysql-database.ts                  # getAuditMysqlDb()：mysql2 pool + drizzle 单例
        ├── local-store.ts                     # LocalAuditStore（jsonl 文件回退）
        ├── checksum.ts                        # computeChecksumFromPayload + verifyPersistedChecksum（v1/v2）
        └── checksum.test.ts                   # vitest：与 Go Blake2b fixture 对齐
```

> 注：旧版结论（2026-06-08）漏列 `factory.ts` / `mysql-store.ts` / `mysql-database.ts` / `checksum.ts` / `checksum.test.ts`，本次已补全。

## 核心类型

```ts
type AuditActor = {
  tenantId: string;
  userId: string;
  deptId?: string | null;
  scopes: string[];        // 决定可见范围
};

interface AuditStore {
  query(actor: AuditActor, input: AuditQueryInput): Promise<AuditQueryResult>;
  exportCsv(actor: AuditActor, input: AuditQueryInput): Promise<string>;
}
```

`AuditEvent / AuditQueryInput / AuditQueryResult` 从 `@agenticx/core-api` 透传。

## PG 审计查询（`PgAuditStore.query`）

- 走 `getIamDb()` 拿 drizzle 实例，读 `gateway_audit_events` 表（`@agenticx/db-schema`）。
- **强制租户隔离**：首条条件恒为 `eq(tenantId, input.tenant_id)`。
- **RBAC 可见性**（`visibilityPredicates(actor)`）：
  - 含 `*` / `audit:manage` / `audit:read:all` → 不加限制（看本租户全量）；
  - 含 `audit:read:dept` 且 `actor.deptId` → `eq(departmentId, deptId)`；
  - 其他 → `eq(userId, actor.userId)`（只看自己）。
- **合规保留窗口**：`applyRetentionWindow` 调 `getAuditRetentionCutoff(tenantId)`（`@agenticx/iam-core`），早于 cutoff 的数据不可见。
- **过滤维度**：`user_id` / `department_id` / `provider` / `model` / `policy_hit`（jsonb `@>` 包含匹配，`safePolicyId` 校验长度 ≤128 + 白名单 `[a-zA-Z0-9._-]`）/ `cross_border=true` / `start` / `end`。
- **分页**：`limit` 夹到 `[1, 1000]`（默认 100），`offset` 钳到 ≥0；先 `count()` 再 `select()` 两次查询，按 `eventTime desc, id desc` 排序。
- **返回**：`total` + `items` + 链状态（`chain_valid` / `chain_error_at` / `chain_error_reason` / `chain_verification: full|partial` / `chain_verified_count` / `chain_legacy_unverified`）。

## PG CSV 导出（`PgAuditStore.exportCsv`）

- 复用 query 的全部过滤与可见性逻辑，但 **不分页**。
- **硬上限** `EXPORT_ROW_HARD_CAP = 100_000` 行：超限直接 `throw`，提示收窄过滤或加时间范围。
- **批量拉取**：每批 2000 行，按 `eventTime desc, id desc` 顺序追加。
- **CSV 列（16 列）**：`id, tenant_id, event_time, event_type, user_id, department_id, provider, model, route, src_region, dst_region, cross_border, residency_rule, total_tokens, latency_ms, checksum`。
- **CSV 转义**：每字段双引号包裹，内部 `"` 转义为 `""`。

## `gateway_audit_events` 表（`packages/db-schema/src/schema/gateway-audit-events.ts`）

- 与 IAM `audit_events` **分表**，专存 Gateway LLM / policy 审计事件。
- 关键列：`id`(ulid PK) / `tenant_id`(FK→tenants, cascade) / `event_time`(timestamptz) / `event_type` / 主体（`user_id` / `user_email` / `department_id` / `session_id` / `client_type` / `client_ip`）/ 模型（`provider` / `model` / `route`）/ 渠道（`channel_id` / `channel_key_ref` / `api_token_id`）/ 消耗（`input/output/total_tokens` / `latency_ms`）/ `digest`(jsonb) / `policies_hit`(jsonb) / `tools_called`(jsonb) / MCP（`mcp_server` / `mcp_tool_name` / `mcp_input_hash` / `mcp_output_hash` / `mcp_status`）/ 跨境（`src_region` / `dst_region` / `cross_border` / `residency_rule`）/ 完整性（`prev_checksum` / `checksum` / `checksum_version` 默认 `v1` / `checksum_payload` / `signature`）。
- **索引**：`tenant+id` 唯一、`tenant+event_time`、`tenant+user+time`、`tenant+dept+time`、`tenant+model+time`、`policies_hit` GIN、`cross_border`。
- 迁移 `0029_audit_checksum_payload.sql` 新增 `checksum_payload`（v2 链）。

## 链校验（`checksum.ts` + `verifyGatewayAuditChain`）

- `computeChecksumFromPayload(prev, payload)`：`blake2b512(`${prev}|${payload}`)` 取前 64 hex。
- `verifyPersistedChecksum`：
  - `checksum_version` 为 `v1`（或空）→ `legacy`（无法验证，仅计 `legacy_unverified`）；
  - `v2` 但缺 `checksum_payload` → `invalid: checksum_payload_missing`；
  - `v2` 重算不匹配 → `invalid: checksum_mismatch`；
  - `v2` 匹配 → `verified`。
- `checkChainSlice`（查询返回的当前页内）：跳过 `clientType === "admin-console"` 的导出审计行，逐行校验 `prev_checksum` 链 + 单行 checksum。
- `verifyGatewayAuditChain`（全表扫描，5000/批）：
  - 需 `*` / `audit:manage` / `audit:read:all`，且 `actor.tenantId === tenantId`，否则 `forbidden` / `tenant_mismatch`；
  - 首行必须 `prevChecksum === "GENESIS"`，否则 `unexpected_first_pointer`；
  - 逐行 `prev_checksum` 链 + `verifyPersistedChecksum`，返回 `scanned` / `verified` / `legacy_unverified` / `verification: full|partial`。
- `checksum.test.ts`：与 Go Gateway 的 Blake2b fixture（`ce374a326a...`）对齐，保证跨语言链校验一致。

## MySQL 实现（`MysqlAuditStore`）

- 与 `PgAuditStore` 同构，差异仅：
  - `getAuditMysqlDb()`（`mysql2/promise` pool + drizzle，`timezone: "Z"` / `charset: utf8mb4`）；
  - `policy_hit` 用 `JSON_CONTAINS(..., CAST(needle AS JSON))` 替代 PG 的 `jsonb @>`；
  - 读 `@agenticx/db-schema/mysql` 的 `gatewayAuditEvents`。

## Local 实现（`LocalAuditStore`，jsonl 回退）

- 构造注入目录，`readAllEvents` 读所有 `.jsonl`（按文件名排序），逐行 `JSON.parse`，坏行 `console.warn` 跳过并记 `parseErrorAt`。
- `normalizeActorScope` 把 scope 归为 `auditor` / `dept-admin` / `member` 三档做内存过滤。
- `checkChain`：自实现 `computeChecksum`（`blake2b512(`${prev}|${JSON.stringify(clone)}`)`，clone 清空 checksum），与 PG/MySQL 的 v2 payload 算法 **不同**。
- `exportCsv`：12 列（无 `src_region` / `dst_region` / `cross_border` / `residency_rule`）。

## Admin-console 消费侧（已验证路由存在）

- `POST /api/audit/query`（`apps/admin-console/src/app/api/audit/query/route.ts`）：`requireAdminSomeScope(["audit:read","audit:read:all","audit:read:dept","audit:manage"])`，经 `lib/audit-service` 的 `buildAuditActor` + `queryAudit`。
- `POST /api/audit/export`（`.../export/route.ts`）：`requireAdminScope(["audit:export"])` + 限流 `takeToken("audit-export:tenant:user", 3, 60_000)`（3 次/分钟/用户，超限 `429`）；导出后 `insertGatewayAuditExportEvent` 写自审计事件，**失败不阻塞下载**。
- `GET /api/audit/chain-verify`（`.../chain-verify/route.ts`）：`requireAdminScope(["audit:read:all"])`，调 `verifyGatewayAuditChain`。
- 自审计事件：`event_type="audit_export"` / `client_type="admin-console"` / `prev_checksum=checksum="admin-export"`（链校验时被跳过，不污染链）。

## 依赖

| 依赖 | 用途 |
|---|---|
| `@agenticx/core-api` | `AuditEvent / AuditDigest / AuditPolicyHit / AuditQueryInput / AuditQueryResult` 类型 |
| `@agenticx/db-schema` | `gatewayAuditEvents` 表（PG + MySQL 双 schema） |
| `@agenticx/iam-core` | `getIamDb()` / `getAuditMysqlDb()` 依赖的 `resolveDatabaseConfig()` / `getAuditRetentionCutoff` |
| `drizzle-orm ^0.45.2` | 查询 builder |
| `mysql2 ^3.14` | MySQL pool |
| `ulid ^2` | 自审计事件 ID 生成 |

## 诚实缺口与注意事项

- **`cost_usd` 未落库**：`AuditEvent` 类型有 `cost_usd`，但 `rowToAuditEvent` 硬编码 `cost_usd: undefined`，schema 也无该列——**成本字段不可查询/导出**，README 中"消耗 cost_usd 精度 8 位"目前是空头承诺。
- **三 store 的 `AuditQueryResult` 形状不一致**：PG/MySQL 返回 `chain_verification` / `chain_verified_count` / `chain_legacy_unverified`，Local 仅返回 `chain_valid` / `chain_error_at` / `chain_error_reason`——前端按 PG 字段取值时 Local 回退会缺字段。
- **三 store 的 CSV 列数不一致**：PG/MySQL 16 列，Local 12 列（缺跨境三列）——同一查询换 store 导出列对不齐。
- **Local 链校验算法与 PG/MySQL 不一致**：Local 用 `JSON.stringify(整事件)` 自实现 `computeChecksum`，PG/MySQL 用 v2 `checksum_payload` 算法——同一批 v2 行在 Local 侧无法用相同方式验证。
- **`signature` 列存在但无 Ed25519 签名实现**：README "S1 定期签名 / Ed25519 链尾签名"为远期，当前仅预留列。
- **远期未实现**（README 自标）：ClickHouse 热/温层、OTel OTLP Exporter、冷归档 + 销毁策略、四维查询与 `features/metering` 全量对接。
- **导出限流维度**：`audit:export` scope + 3 次/分钟/用户；硬上限 10 万行——大租户全量导出需收窄过滤或分批。
- **`policy_hit` 过滤依赖 GIN 索引（PG）/ JSON_CONTAINS（MySQL）**：`safePolicyId` 白名单严格，含 `/` 等字符的 policy id 会被静默丢弃过滤条件（不报错）。

## 与 Enterprise 其他模块的关系

| 关联 | 形态 | 说明 |
|---|---|---|
| `apps/admin-console` | **主消费者** | `/audit` 页面 + `/api/audit/{query,export,chain-verify}` 路由（已验证存在） |
| `apps/gateway`（Go） | **数据生产者** | 每次 LLM 调用 / policy 命中写 `gateway_audit_events`；JSONL 强制成功 + PG 异步双写 + `.pg-pending` 回灌；本包只读 |
| `packages/db-schema` | **schema 依赖** | `gatewayAuditEvents` 表（PG + MySQL 双 schema，含 prev_checksum / checksum / checksum_version / checksum_payload 哈希链） |
| `packages/iam-core` | **运行时依赖** | `resolveDatabaseConfig()` / `getIamDb()` / `getAuditRetentionCutoff` |
| `packages/core-api` | **类型契约** | 所有 audit 类型源头 |
| `features/metering` | **未对接** | 四维查询与 metering 全量对接为进行中项 |
