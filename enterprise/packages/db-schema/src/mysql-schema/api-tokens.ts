import { bigint, index, json, mysqlTable, datetime, uniqueIndex, varchar } from "drizzle-orm/mysql-core";

import { auditColumns } from "./_shared";
import { tenants } from "./tenants";

/** Personal access tokens for gateway M2M auth. */
export const apiTokens = mysqlTable(
  "api_tokens",
  {
    id: bigint("id", { mode: "number" }).autoincrement().primaryKey(),
    tenantId: varchar("tenant_id", { length: 26 }).notNull(),
    userId: varchar("user_id", { length: 26 }).notNull(),
    deptId: varchar("dept_id", { length: 26 }),
    name: varchar("name", { length: 128 }).notNull(),
    tokenHash: varchar("token_hash", { length: 128 }).notNull(),
    tokenPrefix: varchar("token_prefix", { length: 20 }).notNull(),
    scopes: json("scopes").notNull().default([]).$type<string[]>(),
    status: varchar("status", { length: 16 }).notNull().default("active"),
    expireAt: datetime("expire_at", { fsp: 6 }),
    lastUsedAt: datetime("last_used_at", { fsp: 6 }),
    createdBy: varchar("created_by", { length: 26 }).notNull(),
    ...auditColumns,
  },
  (table) => ({
    tokenHashUq: uniqueIndex("api_tokens_token_hash_uq").on(table.tokenHash),
    tenantUserIdx: index("api_tokens_tenant_user_idx").on(table.tenantId, table.userId),
    statusIdx: index("api_tokens_status_idx").on(table.status),
  })
);

export type ApiTokenRow = typeof apiTokens.$inferSelect;
export type NewApiTokenRow = typeof apiTokens.$inferInsert;
