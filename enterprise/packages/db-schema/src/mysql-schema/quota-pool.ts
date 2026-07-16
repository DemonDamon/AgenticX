import { sql } from "drizzle-orm";
import { bigint, index, mysqlTable, primaryKey, text, datetime, varchar } from "drizzle-orm/mysql-core";

/** 共享 Token 池月度累计（网关 enforcement 单一事实源）。 */
export const gatewayQuotaPoolUsage = mysqlTable(
  "gateway_quota_pool_usage",
  {
    tenantId: varchar("tenant_id", { length: 26 }).notNull(),
    scopeType: varchar("scope_type", { length: 16 }).notNull(),
    scopeId: varchar("scope_id", { length: 128 }).notNull(),
    period: varchar("period", { length: 16 }).notNull(),
    usedTotal: bigint("used_total", { mode: "number" }).default(0).notNull(),
    updatedAt: datetime("updated_at", { fsp: 6 }).default(sql`UTC_TIMESTAMP(6)`).notNull(),
  },
  (table) => ({
    pk: primaryKey({
      columns: [table.tenantId, table.scopeType, table.scopeId, table.period],
    }),
  })
);

/** 共享池 reserve/settle/refund 流水（append-only）。 */
export const gatewayQuotaLedger = mysqlTable(
  "gateway_quota_ledger",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    tenantId: varchar("tenant_id", { length: 26 }).notNull(),
    scopeType: varchar("scope_type", { length: 16 }).notNull(),
    scopeId: varchar("scope_id", { length: 128 }).notNull(),
    period: varchar("period", { length: 16 }).notNull(),
    event: varchar("event", { length: 16 }).notNull(),
    deltaTokens: bigint("delta_tokens", { mode: "number" }).notNull(),
    requestId: varchar("request_id", { length: 128 }),
    createdAt: datetime("created_at", { fsp: 6 }).default(sql`UTC_TIMESTAMP(6)`).notNull(),
  },
  (table) => ({
    scopeIdx: index("gateway_quota_ledger_scope_idx").on(
      table.tenantId,
      table.scopeType,
      table.scopeId,
      table.period
    ),
  })
);
