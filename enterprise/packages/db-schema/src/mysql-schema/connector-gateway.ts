import { index, json, mysqlTable, primaryKey, text, varchar } from "drizzle-orm/mysql-core";

import { auditColumns, ulid } from "./_shared";
import { tenants } from "./tenants";

export const connectorDefinitions = mysqlTable(
  "connector_definitions",
  {
    tenantId: ulid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    connectorId: varchar("connector_id", { length: 64 }).notNull(),
    definition: json("definition").notNull().$type<Record<string, unknown>>(),
    status: varchar("status", { length: 16 }).notNull().default("active"),
    ...auditColumns,
  },
  (table) => ({
    pk: primaryKey({ columns: [table.tenantId, table.connectorId] }),
    tenantStatusIdx: index("connector_definitions_tenant_status_idx").on(table.tenantId, table.status),
  })
);

export const connectorConnections = mysqlTable(
  "connector_connections",
  {
    id: ulid("id").primaryKey(),
    tenantId: ulid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    connectorId: varchar("connector_id", { length: 64 }).notNull(),
    name: varchar("name", { length: 128 }).notNull(),
    authType: varchar("auth_type", { length: 16 }).notNull(),
    grantedScopes: json("granted_scopes").$type<string[]>().notNull().default([]),
    encryptedSecret: text("encrypted_secret"),
    status: varchar("status", { length: 16 }).notNull().default("active"),
    ...auditColumns,
  },
  (table) => ({
    tenantConnectorIdx: index("connector_connections_tenant_connector_idx").on(table.tenantId, table.connectorId),
  })
);

export type ConnectorDefinitionRow = typeof connectorDefinitions.$inferSelect;
export type ConnectorConnectionRow = typeof connectorConnections.$inferSelect;
