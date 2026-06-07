import { bigint, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, varchar } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

import { auditColumns, ulid } from "./_shared";

/** 企业 Token 套餐 SKU（配置型，不含支付/出账）。 */
export const enterpriseQuotaPlans = pgTable(
  "enterprise_quota_plans",
  {
    id: ulid("id").primaryKey(),
    tenantId: varchar("tenant_id", { length: 26 }).notNull(),
    name: text("name").notNull(),
    monthlyTokens: bigint("monthly_tokens", { mode: "number" }).notNull(),
    rpm: integer("rpm").default(0).notNull(),
    tpm: integer("tpm").default(0).notNull(),
    maxConcurrency: integer("max_concurrency").default(0).notNull(),
    models: jsonb("models").default([]).notNull().$type<string[]>(),
    period: varchar("period", { length: 8 }).default("month").notNull(),
    status: varchar("status", { length: 16 }).default("draft").notNull(),
    ...auditColumns,
  },
  (table) => ({
    tenantStatusIdx: index("enterprise_quota_plans_tenant_status_idx").on(table.tenantId, table.status),
  })
);

/** 套餐绑定：tenant / dept / user scope。 */
export const enterpriseQuotaPlanAssignments = pgTable(
  "enterprise_quota_plan_assignments",
  {
    id: ulid("id").primaryKey(),
    tenantId: varchar("tenant_id", { length: 26 }).notNull(),
    planId: varchar("plan_id", { length: 26 }).notNull(),
    scopeType: varchar("scope_type", { length: 16 }).notNull(),
    scopeId: varchar("scope_id", { length: 128 }).notNull(),
    periodStart: timestamp("period_start", { withTimezone: true }).notNull(),
    periodEnd: timestamp("period_end", { withTimezone: true }).notNull(),
    status: varchar("status", { length: 16 }).default("active").notNull(),
    pendingPlanId: varchar("pending_plan_id", { length: 26 }),
    lastRolloverKey: varchar("last_rollover_key", { length: 128 }),
    ...auditColumns,
  },
  (table) => ({
    planIdx: index("enterprise_quota_plan_assign_plan_idx").on(table.tenantId, table.planId),
    scopeActiveUk: uniqueIndex("enterprise_quota_plan_assign_scope_active_uk")
      .on(table.tenantId, table.scopeType, table.scopeId)
      .where(sql`${table.status} = 'active'`),
  })
);
