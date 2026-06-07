/**
 * Enterprise 运行时配置（原 enterprise/.runtime/admin/*.json）。
 * Serverless/Vercel 场景下数据源为 Postgres。
 */
import {
  boolean,
  index,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  varchar,
  numeric,
} from "drizzle-orm/pg-core";

import { auditColumns } from "./_shared";

/** 租户级模型服务商配置（单行 = 一家 provider）。 */
export const enterpriseRuntimeModelProviders = pgTable(
  "enterprise_runtime_model_providers",
  {
    id: varchar("id", { length: 26 }).primaryKey(),
    tenantId: varchar("tenant_id", { length: 26 }).notNull(),
    providerId: text("provider_id").notNull(),
    displayName: text("display_name").notNull(),
    baseUrl: text("base_url").notNull(),
    /** AES-256-GCM 封装后的字符串；不含明文 key。 */
    apiKeyCipher: text("api_key_cipher").default("").notNull(),
    enabled: boolean("enabled").default(true).notNull(),
    isDefault: boolean("is_default").default(false).notNull(),
    route: varchar("route", { length: 64 }).default("third-party").notNull(),
    envKey: text("env_key"),
    models: jsonb("models").default([]).notNull().$type<Array<Record<string, unknown>>>(),
    ...auditColumns,
  },
  (table) => ({
    tenantProviderUk: uniqueIndex("enterprise_runtime_mp_tenant_prov_uk").on(table.tenantId, table.providerId),
  })
);

/** 用户对模型 id（provider/model）可见性映射。assignment_key：user ulid 或 email:xxx */
export const enterpriseRuntimeUserVisibleModels = pgTable(
  "enterprise_runtime_user_visible_models",
  {
    tenantId: varchar("tenant_id", { length: 26 }).notNull(),
    assignmentKey: text("assignment_key").notNull(),
    modelId: text("model_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    pk: primaryKey({
      columns: [table.tenantId, table.assignmentKey, table.modelId],
    }),
  })
);

/** 租户 token 配额整包 JSON（等价原 quotas.json）。 */
export const enterpriseRuntimeTokenQuotas = pgTable("enterprise_runtime_token_quotas", {
  tenantId: varchar("tenant_id", { length: 26 }).primaryKey(),
  config: jsonb("config").notNull().$type<Record<string, unknown>>(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

/** 已发布策略快照（单租户一行，JSON 等价 PolicySnapshot）。 */
export const enterpriseRuntimePolicySnapshots = pgTable("enterprise_runtime_policy_snapshots", {
  tenantId: varchar("tenant_id", { length: 26 }).primaryKey(),
  snapshot: jsonb("snapshot").notNull().$type<Record<string, unknown>>(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

/** 租户动态计价配置（等价 pricing.yaml + surcharges，供网关快照拉取）。 */
export const enterpriseRuntimePricing = pgTable("enterprise_runtime_pricing", {
  tenantId: varchar("tenant_id", { length: 26 }).primaryKey(),
  config: jsonb("config").notNull().$type<Record<string, unknown>>(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

/** 租户成本/词元预算整包 JSON。 */
export const enterpriseRuntimeBudgets = pgTable("enterprise_runtime_budgets", {
  tenantId: varchar("tenant_id", { length: 26 }).primaryKey(),
  config: jsonb("config").notNull().$type<Record<string, unknown>>(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

/** 网关预算预警/熔断事件（admin 只读查询）。 */
export const gatewayBudgetAlerts = pgTable(
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
    usedValue: numeric("used_value", { precision: 18, scale: 8 }).default("0").notNull(),
    limitValue: numeric("limit_value", { precision: 18, scale: 8 }).default("0").notNull(),
    warnThresholdPct: numeric("warn_threshold_pct", { precision: 5, scale: 2 }).default("0").notNull(),
    description: text("description"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    tenantTimeIdx: index("gateway_budget_alerts_tenant_time_idx").on(table.tenantId, table.createdAt),
  })
);

/** 会话级临时 scope 授权（智能体协作 TTL 授予）。 */
export const sessionGrants = pgTable(
  "session_grants",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    tenantId: varchar("tenant_id", { length: 26 }).notNull(),
    sessionId: varchar("session_id", { length: 128 }).notNull(),
    scopes: jsonb("scopes").notNull().$type<string[]>(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdBy: varchar("created_by", { length: 64 }),
    description: text("description"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    tenantSessionIdx: index("session_grants_tenant_session_idx").on(table.tenantId, table.sessionId, table.expiresAt),
  })
);

/** PAT 吊销版本与 hash 列表（网关近实时拉取）。 */
export const enterpriseRuntimePatRevocation = pgTable("enterprise_runtime_pat_revocation", {
  tenantId: varchar("tenant_id", { length: 26 }).primaryKey(),
  version: numeric("version", { precision: 20, scale: 0 }).default("0").notNull(),
  revokedHashes: jsonb("revoked_hashes").default([]).notNull().$type<string[]>(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

/** web-portal refresh token 会话（多副本 serverless）。 */
export const authRefreshSessions = pgTable("auth_refresh_sessions", {
  sessionId: varchar("session_id", { length: 160 }).primaryKey(),
  userId: varchar("user_id", { length: 128 }).notNull(),
  tenantId: varchar("tenant_id", { length: 26 }).notNull(),
  deptId: varchar("dept_id", { length: 26 }),
  email: text("email").notNull(),
  scopesJson: jsonb("scopes_json").notNull().$type<string[]>(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});
