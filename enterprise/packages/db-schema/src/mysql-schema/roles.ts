import { boolean, json, mysqlTable, uniqueIndex, varchar } from "drizzle-orm/mysql-core";
import { auditColumns, ulid } from "./_shared";
import { tenants } from "./tenants";

export const roles = mysqlTable(
  "roles",
  {
    id: ulid("id").primaryKey(),
    tenantId: ulid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "restrict" }),
    code: varchar("code", { length: 64 }).notNull(),
    name: varchar("name", { length: 128 }).notNull(),
    scopes: json("scopes").$type<string[]>().notNull().default([]),
    immutable: boolean("immutable").notNull().default(false),
    ...auditColumns,
  },
  (table) => ({
    tenantCodeUq: uniqueIndex("roles_tenant_code_uq").on(table.tenantId, table.code),
  })
);

export type Role = typeof roles.$inferSelect;
export type NewRole = typeof roles.$inferInsert;

