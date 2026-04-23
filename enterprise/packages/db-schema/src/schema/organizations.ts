import { pgTable, uniqueIndex, varchar } from "drizzle-orm/pg-core";
import { auditColumns, ulid } from "./_shared";
import { tenants } from "./tenants";

export const organizations = pgTable(
  "organizations",
  {
    id: ulid("id").primaryKey(),
    tenantId: ulid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "restrict" }),
    name: varchar("name", { length: 128 }).notNull(),
    ...auditColumns,
  },
  (table) => ({
    tenantNameUq: uniqueIndex("org_tenant_name_uq").on(table.tenantId, table.name),
  })
);

export type Organization = typeof organizations.$inferSelect;
export type NewOrganization = typeof organizations.$inferInsert;

