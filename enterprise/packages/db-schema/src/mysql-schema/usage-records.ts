import { bigint, index, int, decimal, mysqlTable, datetime, varchar } from "drizzle-orm/mysql-core";
import { tenants } from "./tenants";
import { auditColumns, ulid } from "./_shared";

export const usageRecords = mysqlTable(
  "usage_records",
  {
    id: ulid("id").primaryKey(),
    tenantId: ulid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "restrict" }),
    deptId: varchar("dept_id", { length: 64 }),
    userId: varchar("user_id", { length: 64 }),
    apiTokenId: bigint("api_token_id", { mode: "number" }),
    provider: varchar("provider", { length: 64 }).notNull(),
    model: varchar("model", { length: 128 }).notNull(),
    route: varchar("route", { length: 32 }).notNull(),
    timeBucket: datetime("time_bucket", { fsp: 6 }).notNull(),
    inputTokens: decimal("input_tokens", { precision: 20, scale: 0 }).default("0").notNull(),
    outputTokens: decimal("output_tokens", { precision: 20, scale: 0 }).default("0").notNull(),
    totalTokens: decimal("total_tokens", { precision: 20, scale: 0 }).default("0").notNull(),
    cachedTokens: decimal("cached_tokens", { precision: 20, scale: 0 }).default("0").notNull(),
    cacheReadInputTokens: decimal("cache_read_input_tokens", { precision: 20, scale: 0 }).default("0").notNull(),
    cacheCreationInputTokens: decimal("cache_creation_input_tokens", { precision: 20, scale: 0 }).default("0").notNull(),
    reasoningTokens: decimal("reasoning_tokens", { precision: 20, scale: 0 }).default("0").notNull(),
    usageSource: varchar("usage_source", { length: 32 }),
    costUsd: decimal("cost_usd", { precision: 18, scale: 8 }).default("0").notNull(),
    pricingVersion: varchar("pricing_version", { length: 128 }),
    traceId: varchar("trace_id", { length: 128 }),
    traceStep: int("trace_step"),
    ...auditColumns,
  },
  (table) => ({
    tenantTimeIdx: index("usage_records_tenant_time_idx").on(table.tenantId, table.timeBucket),
    tenantDimsIdx: index("usage_records_tenant_dims_idx").on(table.tenantId, table.deptId, table.userId, table.provider),
  })
);

