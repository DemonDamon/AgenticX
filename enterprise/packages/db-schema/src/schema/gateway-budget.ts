import { bigint, numeric, pgTable, primaryKey, text, timestamp, varchar } from "drizzle-orm/pg-core";

/** Shared spend ledger. Company, organization, department and personal caps each
 * reserve a row in the same database transaction. */
export const gatewayBudgetUsage = pgTable(
  "gateway_budget_usage",
  {
    tenantId: varchar("tenant_id", { length: 26 }).notNull(),
    dimension: varchar("dimension", { length: 16 }).notNull(),
    dimensionKey: varchar("dimension_key", { length: 128 }).notNull(),
    period: varchar("period", { length: 16 }).notNull(),
    unit: varchar("unit", { length: 16 }).notNull(),
    usedValue: numeric("used_value", { precision: 38, scale: 18 }).default("0").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.tenantId, table.dimension, table.dimensionKey, table.period, table.unit] }),
  }),
);

/** Durable receipt makes budget settlement and refund idempotent. */
export const gatewayBudgetReservations = pgTable("gateway_budget_reservations", {
  receiptId: varchar("receipt_id", { length: 32 }).primaryKey(),
  tenantId: varchar("tenant_id", { length: 26 }).notNull(),
  state: varchar("state", { length: 16 }).notNull(),
  linesJson: text("lines_json").notNull(),
  actualTokens: bigint("actual_tokens", { mode: "number" }),
  actualCostUsd: numeric("actual_cost_usd", { precision: 38, scale: 18 }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export type GatewayBudgetUsageRow = typeof gatewayBudgetUsage.$inferSelect;
export type GatewayBudgetReservationRow = typeof gatewayBudgetReservations.$inferSelect;
