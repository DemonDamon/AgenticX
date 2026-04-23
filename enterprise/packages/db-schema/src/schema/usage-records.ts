import { index, numeric, pgTable, timestamp, varchar } from "drizzle-orm/pg-core";
import { tenants } from "./tenants";
import { auditColumns, ulid } from "./_shared";

export const usageRecords = pgTable(
  "usage_records",
  {
    id: ulid("id").primaryKey(),
    tenantId: ulid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "restrict" }),
    deptId: varchar("dept_id", { length: 64 }),
    userId: varchar("user_id", { length: 64 }),
    provider: varchar("provider", { length: 64 }).notNull(),
    model: varchar("model", { length: 128 }).notNull(),
    route: varchar("route", { length: 32 }).notNull(),
    timeBucket: timestamp("time_bucket", { withTimezone: true }).notNull(),
    inputTokens: numeric("input_tokens", { precision: 20, scale: 0 }).default("0").notNull(),
    outputTokens: numeric("output_tokens", { precision: 20, scale: 0 }).default("0").notNull(),
    totalTokens: numeric("total_tokens", { precision: 20, scale: 0 }).default("0").notNull(),
    costUsd: numeric("cost_usd", { precision: 18, scale: 8 }).default("0").notNull(),
    ...auditColumns,
  },
  (table) => ({
    tenantTimeIdx: index("usage_records_tenant_time_idx").on(table.tenantId, table.timeBucket),
    tenantDimsIdx: index("usage_records_tenant_dims_idx").on(table.tenantId, table.deptId, table.userId, table.provider),
  })
);

