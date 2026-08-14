import { sql } from "drizzle-orm";
import { datetime, int, mysqlTable, varchar } from "drizzle-orm/mysql-core";

/**
 * 每租户一行的联网搜索 Provider 日调用闸门。
 * 普通搜索与深度研究共享这张表，跨实例靠单条条件 UPDATE 原子扣减。
 */
export const enterpriseWebSearchDailyQuota = mysqlTable("enterprise_web_search_daily_quota", {
  tenantId: varchar("tenant_id", { length: 26 }).primaryKey(),
  /** 0 表示不限额；不限额时仍累计真实用量。 */
  maxProviderCalls: int("max_provider_calls").default(0).notNull(),
  /** UTC 自然日 `YYYY-MM-DD`；跨日由扣减语句原子重置。 */
  usageDay: varchar("usage_day", { length: 10 }).default("").notNull(),
  providerCallsUsed: int("provider_calls_used").default(0).notNull(),
  updatedAt: datetime("updated_at", { fsp: 6 }).default(sql`(UTC_TIMESTAMP(6))`).notNull(),
});
