import { sql } from "drizzle-orm";
import {
  bigint,
  datetime,
  index,
  int,
  json,
  mysqlTable,
  text,
  uniqueIndex,
  varchar,
} from "drizzle-orm/mysql-core";

import { auditColumns, ulid } from "./_shared";

/** 企业 Token 套餐 SKU（配置型，不含支付/出账）。 */
export const enterpriseQuotaPlans = mysqlTable(
  "enterprise_quota_plans",
  {
    id: ulid("id").primaryKey(),
    tenantId: varchar("tenant_id", { length: 26 }).notNull(),
    name: text("name").notNull(),
    monthlyTokens: bigint("monthly_tokens", { mode: "number" }).notNull(),
    rpm: int("rpm").default(0).notNull(),
    tpm: int("tpm").default(0).notNull(),
    maxConcurrency: int("max_concurrency").default(0).notNull(),
    models: json("models").default([]).notNull().$type<string[]>(),
    period: varchar("period", { length: 8 }).default("month").notNull(),
    status: varchar("status", { length: 16 }).default("draft").notNull(),
    ...auditColumns,
  },
  (table) => ({
    tenantStatusIdx: index("enterprise_quota_plans_tenant_status_idx").on(table.tenantId, table.status),
  }),
);

/** 套餐绑定：tenant / dept / user scope。 */
export const enterpriseQuotaPlanAssignments = mysqlTable(
  "enterprise_quota_plan_assignments",
  {
    id: ulid("id").primaryKey(),
    tenantId: varchar("tenant_id", { length: 26 }).notNull(),
    planId: varchar("plan_id", { length: 26 }).notNull(),
    scopeType: varchar("scope_type", { length: 16 }).notNull(),
    scopeId: varchar("scope_id", { length: 128 }).notNull(),
    periodStart: datetime("period_start", { fsp: 6 }).notNull(),
    periodEnd: datetime("period_end", { fsp: 6 }).notNull(),
    status: varchar("status", { length: 16 }).default("active").notNull(),
    pendingPlanId: varchar("pending_plan_id", { length: 26 }),
    lastRolloverKey: varchar("last_rollover_key", { length: 128 }),
    ...auditColumns,
    // Replaces PG partial unique on active assignments.
    activeScopeKey: varchar("active_scope_key", { length: 200 }).generatedAlwaysAs(
      sql`(CASE WHEN \`status\` = 'active' THEN concat(\`scope_type\`, ':', \`scope_id\`) ELSE NULL END)`,
      { mode: "stored" },
    ),
  },
  (table) => ({
    planIdx: index("enterprise_quota_plan_assign_plan_idx").on(table.tenantId, table.planId),
    scopeActiveUk: uniqueIndex("enterprise_quota_plan_assign_scope_active_uk").on(
      table.tenantId,
      table.activeScopeKey,
    ),
  }),
);
