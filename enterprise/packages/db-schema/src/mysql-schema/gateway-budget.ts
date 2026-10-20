import { sql } from "drizzle-orm";
import { bigint, datetime, decimal, mysqlTable, primaryKey, text, varchar } from "drizzle-orm/mysql-core";

export const gatewayBudgetUsage = mysqlTable(
  "gateway_budget_usage",
  {
    tenantId: varchar("tenant_id", { length: 26 }).notNull(),
    dimension: varchar("dimension", { length: 16 }).notNull(),
    dimensionKey: varchar("dimension_key", { length: 128 }).notNull(),
    period: varchar("period", { length: 16 }).notNull(),
    unit: varchar("unit", { length: 16 }).notNull(),
    usedValue: decimal("used_value", { precision: 38, scale: 18 }).default("0").notNull(),
    updatedAt: datetime("updated_at", { fsp: 6 }).default(sql`(UTC_TIMESTAMP(6))`).notNull(),
  },
  (table) => ({
    pk: primaryKey({
      columns: [table.tenantId, table.dimension, table.dimensionKey, table.period, table.unit],
      name: "gateway_budget_usage_pk",
    }),
  }),
);

export const gatewayBudgetReservations = mysqlTable("gateway_budget_reservations", {
  receiptId: varchar("receipt_id", { length: 32 }).primaryKey(),
  tenantId: varchar("tenant_id", { length: 26 }).notNull(),
  state: varchar("state", { length: 16 }).notNull(),
  linesJson: text("lines_json").notNull(),
  actualTokens: bigint("actual_tokens", { mode: "number" }),
  actualCostUsd: decimal("actual_cost_usd", { precision: 38, scale: 18 }),
  createdAt: datetime("created_at", { fsp: 6 }).default(sql`(UTC_TIMESTAMP(6))`).notNull(),
  updatedAt: datetime("updated_at", { fsp: 6 }).default(sql`(UTC_TIMESTAMP(6))`).notNull(),
});

export type GatewayBudgetUsageRow = typeof gatewayBudgetUsage.$inferSelect;
export type GatewayBudgetReservationRow = typeof gatewayBudgetReservations.$inferSelect;
