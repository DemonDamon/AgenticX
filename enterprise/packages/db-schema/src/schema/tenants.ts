import { pgTable, uniqueIndex, varchar } from "drizzle-orm/pg-core";
import { auditColumns, ulid } from "./_shared";

export const tenants = pgTable(
  "tenants",
  {
    id: ulid("id").primaryKey(),
    code: varchar("code", { length: 64 }).notNull(),
    name: varchar("name", { length: 128 }).notNull(),
    plan: varchar("plan", { length: 32 }).notNull().default("enterprise"),
    ...auditColumns,
  },
  (table) => ({
    codeUq: uniqueIndex("tenants_code_uq").on(table.code),
  })
);

export type Tenant = typeof tenants.$inferSelect;
export type NewTenant = typeof tenants.$inferInsert;

