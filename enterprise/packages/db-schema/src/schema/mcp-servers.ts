import { index, jsonb, pgTable, text, uniqueIndex, varchar } from "drizzle-orm/pg-core";

import { auditColumns, ulid } from "./_shared";
import { tenants } from "./tenants";

export const mcpServers = pgTable(
  "mcp_servers",
  {
    id: ulid("id").primaryKey(),
    tenantId: ulid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 64 }).notNull(),
    displayName: varchar("display_name", { length: 128 }),
    transport: varchar("transport", { length: 32 }).notNull().default("streamable-http"),
    backendType: varchar("backend_type", { length: 32 }).notNull(),
    backendConfig: jsonb("backend_config").notNull().default({}).$type<Record<string, unknown>>(),
    requiredScopes: text("required_scopes").array().notNull().default([]),
    status: varchar("status", { length: 16 }).notNull().default("active"),
    rateLimit: jsonb("rate_limit").notNull().default({}).$type<Record<string, unknown>>(),
    ...auditColumns,
  },
  (table) => ({
    tenantNameUq: uniqueIndex("mcp_servers_tenant_name_uq").on(table.tenantId, table.name),
    tenantStatusIdx: index("mcp_servers_tenant_status_idx").on(table.tenantId, table.status),
  })
);

export type McpServerRow = typeof mcpServers.$inferSelect;
export type NewMcpServerRow = typeof mcpServers.$inferInsert;
