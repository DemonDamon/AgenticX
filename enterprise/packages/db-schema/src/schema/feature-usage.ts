import { index, integer, pgTable, primaryKey, timestamp, varchar } from "drizzle-orm/pg-core";

/** Per-user daily counters for metered features (search calls, research runs).
 * Week and month windows sum these daily rows. */
export const enterpriseFeatureUsageDaily = pgTable(
  "enterprise_feature_usage_daily",
  {
    tenantId: varchar("tenant_id", { length: 26 }).notNull(),
    /** search_provider_calls | deep_research_runs */
    feature: varchar("feature", { length: 32 }).notNull(),
    userId: varchar("user_id", { length: 64 }).notNull(),
    /** Department at the time of use, for reporting only. Shared caps use a separate ledger. */
    deptId: varchar("dept_id", { length: 64 }),
    /** UTC calendar day `YYYY-MM-DD`. */
    usageDay: varchar("usage_day", { length: 10 }).notNull(),
    used: integer("used").default(0).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    pk: primaryKey({
      columns: [table.tenantId, table.feature, table.userId, table.usageDay],
      name: "enterprise_feature_usage_daily_pk",
    }),
    featureDayIdx: index("enterprise_feature_usage_daily_feature_day_idx").on(
      table.tenantId,
      table.feature,
      table.usageDay,
    ),
  }),
);

export type FeatureUsageDailyRow = typeof enterpriseFeatureUsageDaily.$inferSelect;

/** Shared daily ledger. `scope` is `company` or `department`; company `scope_id` is the tenant id. */
export const enterpriseFeatureUsageSharedDaily = pgTable(
  "enterprise_feature_usage_shared_daily",
  {
    tenantId: varchar("tenant_id", { length: 26 }).notNull(),
    feature: varchar("feature", { length: 32 }).notNull(),
    scope: varchar("scope", { length: 16 }).notNull(),
    scopeId: varchar("scope_id", { length: 64 }).notNull(),
    usageDay: varchar("usage_day", { length: 10 }).notNull(),
    used: integer("used").default(0).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    pk: primaryKey({
      columns: [table.tenantId, table.feature, table.scope, table.scopeId, table.usageDay],
      name: "enterprise_feature_usage_shared_daily_pk",
    }),
  }),
);

export type FeatureUsageSharedDailyRow = typeof enterpriseFeatureUsageSharedDaily.$inferSelect;
