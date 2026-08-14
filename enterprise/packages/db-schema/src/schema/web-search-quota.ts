import { integer, pgTable, timestamp, varchar } from "drizzle-orm/pg-core";

/**
 * 每租户一行的联网搜索 Provider 日调用闸门。
 * 普通搜索与深度研究共享这张表，跨实例靠单条条件 UPDATE 原子扣减。
 */
export const enterpriseWebSearchDailyQuota = pgTable("enterprise_web_search_daily_quota", {
  tenantId: varchar("tenant_id", { length: 26 }).primaryKey(),
  /** 0 表示不限额；不限额时仍累计真实用量。 */
  maxProviderCalls: integer("max_provider_calls").default(0).notNull(),
  /** UTC 自然日 `YYYY-MM-DD`；跨日由扣减语句原子重置。 */
  usageDay: varchar("usage_day", { length: 10 }).default("").notNull(),
  providerCallsUsed: integer("provider_calls_used").default(0).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});
