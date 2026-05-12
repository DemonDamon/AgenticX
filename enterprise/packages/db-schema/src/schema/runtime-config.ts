/**
 * Enterprise 运行时配置（原 enterprise/.runtime/admin/*.json）。
 * Serverless/Vercel 场景下数据源为 Postgres。
 */
import {
  boolean,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  varchar,
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
