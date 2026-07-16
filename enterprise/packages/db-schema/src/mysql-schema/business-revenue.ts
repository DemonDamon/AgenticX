import { sql } from "drizzle-orm";
import { decimal, mysqlTable, text, datetime, varchar } from "drizzle-orm/mysql-core";

export const enterpriseBusinessRevenue = mysqlTable("enterprise_business_revenue", {
  id: varchar("id", { length: 26 }).primaryKey(),
  tenantId: varchar("tenant_id", { length: 26 }).notNull(),
  scenarioLabel: varchar("scenario_label", { length: 128 }).notNull(),
  periodStart: datetime("period_start", { fsp: 6 }).notNull(),
  periodEnd: datetime("period_end", { fsp: 6 }).notNull(),
  revenueUsd: decimal("revenue_usd", { precision: 18, scale: 8 }).notNull(),
  notes: text("notes"),
  createdAt: datetime("created_at", { fsp: 6 }).default(sql`(UTC_TIMESTAMP(6))`).notNull(),
  updatedAt: datetime("updated_at", { fsp: 6 }).default(sql`(UTC_TIMESTAMP(6))`).notNull(),
});
