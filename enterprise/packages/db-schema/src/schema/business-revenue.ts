import { numeric, pgTable, text, timestamp, varchar } from "drizzle-orm/pg-core";

export const enterpriseBusinessRevenue = pgTable("enterprise_business_revenue", {
  id: varchar("id", { length: 26 }).primaryKey(),
  tenantId: varchar("tenant_id", { length: 26 }).notNull(),
  scenarioLabel: varchar("scenario_label", { length: 128 }).notNull(),
  periodStart: timestamp("period_start", { withTimezone: true }).notNull(),
  periodEnd: timestamp("period_end", { withTimezone: true }).notNull(),
  revenueUsd: numeric("revenue_usd", { precision: 18, scale: 8 }).notNull(),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});
