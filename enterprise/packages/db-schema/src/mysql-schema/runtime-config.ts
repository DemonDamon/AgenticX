import { sql } from "drizzle-orm";
/**
 * Enterprise 运行时配置（原 enterprise/.runtime/admin/*.json）。
 * Serverless/Vercel 场景下数据源为 Postgres。
 */
import { boolean, index, int, json, mysqlTable, primaryKey, text, datetime, uniqueIndex, varchar, decimal } from "drizzle-orm/mysql-core";

import { auditColumns } from "./_shared";

/** 租户级模型服务商配置（单行 = 一家 provider）。 */
export const enterpriseRuntimeModelProviders = mysqlTable(
  "enterprise_runtime_model_providers",
  {
    id: varchar("id", { length: 26 }).primaryKey(),
    tenantId: varchar("tenant_id", { length: 26 }).notNull(),
    providerId: varchar("provider_id", { length: 128 }).notNull(),
    displayName: text("display_name").notNull(),
    baseUrl: text("base_url").notNull(),
    /** AES-256-GCM 封装后的字符串；不含明文 key。 */
    apiKeyCipher: text("api_key_cipher").default("").notNull(),
    enabled: boolean("enabled").default(true).notNull(),
    isDefault: boolean("is_default").default(false).notNull(),
    route: varchar("route", { length: 64 }).default("third-party").notNull(),
    envKey: text("env_key"),
    models: json("models").default([]).notNull().$type<Array<Record<string, unknown>>>(),
    ...auditColumns,
  },
  (table) => ({
    tenantProviderUk: uniqueIndex("enterprise_runtime_mp_tenant_prov_uk").on(table.tenantId, table.providerId),
  })
);

/** 用户对模型 id（provider/model）可见性映射。assignment_key：user ulid 或 email:xxx */
export const enterpriseRuntimeUserVisibleModels = mysqlTable(
  "enterprise_runtime_user_visible_models",
  {
    tenantId: varchar("tenant_id", { length: 26 }).notNull(),
    assignmentKey: varchar("assignment_key", { length: 320 }).notNull(),
    modelId: varchar("model_id", { length: 256 }).notNull(),
    createdAt: datetime("created_at", { fsp: 6 }).default(sql`(UTC_TIMESTAMP(6))`).notNull(),
  },
  (table) => ({
    pk: primaryKey({
      columns: [table.tenantId, table.assignmentKey, table.modelId],
      // MySQL identifier limit is 64 chars; drizzle auto name exceeds it.
      name: "enterprise_runtime_uvm_pk",
    }),
  })
);

/** 租户 token 配额整包 JSON（等价原 quotas.json）。 */
export const enterpriseRuntimeTokenQuotas = mysqlTable("enterprise_runtime_token_quotas", {
  tenantId: varchar("tenant_id", { length: 26 }).primaryKey(),
  config: json("config").notNull().$type<Record<string, unknown>>(),
  updatedAt: datetime("updated_at", { fsp: 6 }).default(sql`(UTC_TIMESTAMP(6))`).notNull(),
});

/** 已发布策略快照（单租户一行，JSON 等价 PolicySnapshot）。 */
export const enterpriseRuntimePolicySnapshots = mysqlTable("enterprise_runtime_policy_snapshots", {
  tenantId: varchar("tenant_id", { length: 26 }).primaryKey(),
  snapshot: json("snapshot").notNull().$type<Record<string, unknown>>(),
  updatedAt: datetime("updated_at", { fsp: 6 }).default(sql`(UTC_TIMESTAMP(6))`).notNull(),
});

/** 租户动态计价配置（等价 pricing.yaml + surcharges，供网关快照拉取）。 */
export const enterpriseRuntimePricing = mysqlTable("enterprise_runtime_pricing", {
  tenantId: varchar("tenant_id", { length: 26 }).primaryKey(),
  config: json("config").notNull().$type<Record<string, unknown>>(),
  updatedAt: datetime("updated_at", { fsp: 6 }).default(sql`(UTC_TIMESTAMP(6))`).notNull(),
});

/** 租户成本/词元预算整包 JSON。 */
export const enterpriseRuntimeBudgets = mysqlTable("enterprise_runtime_budgets", {
  tenantId: varchar("tenant_id", { length: 26 }).primaryKey(),
  config: json("config").notNull().$type<Record<string, unknown>>(),
  updatedAt: datetime("updated_at", { fsp: 6 }).default(sql`(UTC_TIMESTAMP(6))`).notNull(),
});

/** 网关预算预警/熔断事件（admin 只读查询）。 */
export const gatewayBudgetAlerts = mysqlTable(
  "gateway_budget_alerts",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    tenantId: varchar("tenant_id", { length: 26 }).notNull(),
    deptId: varchar("dept_id", { length: 64 }),
    userId: varchar("user_id", { length: 64 }),
    dimension: varchar("dimension", { length: 16 }).notNull(),
    dimensionKey: varchar("dimension_key", { length: 128 }).notNull(),
    period: varchar("period", { length: 16 }).notNull(),
    unit: varchar("unit", { length: 16 }).notNull(),
    alertType: varchar("alert_type", { length: 16 }).notNull(),
    usedValue: decimal("used_value", { precision: 18, scale: 8 }).default("0").notNull(),
    limitValue: decimal("limit_value", { precision: 18, scale: 8 }).default("0").notNull(),
    warnThresholdPct: decimal("warn_threshold_pct", { precision: 5, scale: 2 }).default("0").notNull(),
    description: text("description"),
    createdAt: datetime("created_at", { fsp: 6 }).default(sql`(UTC_TIMESTAMP(6))`).notNull(),
  },
  (table) => ({
    tenantTimeIdx: index("gateway_budget_alerts_tenant_time_idx").on(table.tenantId, table.createdAt),
  })
);

/** 会话级临时 scope 授权（智能体协作 TTL 授予）。 */
export const sessionGrants = mysqlTable(
  "session_grants",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    tenantId: varchar("tenant_id", { length: 26 }).notNull(),
    sessionId: varchar("session_id", { length: 128 }).notNull(),
    scopes: json("scopes").notNull().$type<string[]>(),
    expiresAt: datetime("expires_at", { fsp: 6 }).notNull(),
    revokedAt: datetime("revoked_at", { fsp: 6 }),
    createdBy: varchar("created_by", { length: 64 }),
    description: text("description"),
    createdAt: datetime("created_at", { fsp: 6 }).default(sql`(UTC_TIMESTAMP(6))`).notNull(),
  },
  (table) => ({
    tenantSessionIdx: index("session_grants_tenant_session_idx").on(table.tenantId, table.sessionId, table.expiresAt),
  })
);

/** PAT 吊销版本与 hash 列表（网关近实时拉取）。 */
export const enterpriseRuntimePatRevocation = mysqlTable("enterprise_runtime_pat_revocation", {
  tenantId: varchar("tenant_id", { length: 26 }).primaryKey(),
  version: decimal("version", { precision: 20, scale: 0 }).default("0").notNull(),
  revokedHashes: json("revoked_hashes").default([]).notNull().$type<string[]>(),
  updatedAt: datetime("updated_at", { fsp: 6 }).default(sql`(UTC_TIMESTAMP(6))`).notNull(),
});

/** 租户合规：数据驻留、跨境策略、审计留存（HIPAA 式可配）。 */
export const enterpriseRuntimeCompliance = mysqlTable("enterprise_runtime_compliance", {
  tenantId: varchar("tenant_id", { length: 26 }).primaryKey(),
  dataResidency: varchar("data_residency", { length: 16 }),
  crossBorderAction: varchar("cross_border_action", { length: 32 }).default("allow").notNull(),
  auditRetentionYears: int("audit_retention_years").default(6).notNull(),
  appendOnly: boolean("append_only").default(true).notNull(),
  updatedAt: datetime("updated_at", { fsp: 6 }).default(sql`(UTC_TIMESTAMP(6))`).notNull(),
});

/** 租户 MCP 反代 Server 整包 JSON（gateway /v1/mcp/{server_id}/* 拉取）。 */
export const enterpriseRuntimeMcpServers = mysqlTable("enterprise_runtime_mcp_servers", {
  tenantId: varchar("tenant_id", { length: 26 }).primaryKey(),
  config: json("config").notNull().$type<{ servers: unknown[] }>(),
  updatedAt: datetime("updated_at", { fsp: 6 }).default(sql`(UTC_TIMESTAMP(6))`).notNull(),
});

/** web-portal refresh token 会话（多副本 serverless）。 */
export const authRefreshSessions = mysqlTable("auth_refresh_sessions", {
  sessionId: varchar("session_id", { length: 160 }).primaryKey(),
  userId: varchar("user_id", { length: 128 }).notNull(),
  tenantId: varchar("tenant_id", { length: 26 }).notNull(),
  deptId: varchar("dept_id", { length: 26 }),
  email: text("email").notNull(),
  scopesJson: json("scopes_json").notNull().$type<string[]>(),
  expiresAt: datetime("expires_at", { fsp: 6 }).notNull(),
  createdAt: datetime("created_at", { fsp: 6 }).default(sql`(UTC_TIMESTAMP(6))`).notNull(),
});
