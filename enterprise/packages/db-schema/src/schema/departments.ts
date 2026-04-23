import { index, pgTable, uniqueIndex, varchar } from "drizzle-orm/pg-core";
import { auditColumns, ulid } from "./_shared";
import { organizations } from "./organizations";
import { tenants } from "./tenants";

export const departments = pgTable(
  "departments",
  {
    id: ulid("id").primaryKey(),
    tenantId: ulid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "restrict" }),
    orgId: ulid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    parentId: ulid("parent_id"),
    name: varchar("name", { length: 128 }).notNull(),
    path: varchar("path", { length: 1024 }).notNull(),
    ...auditColumns,
  },
  (table) => ({
    tenantOrgNameUq: uniqueIndex("dept_tenant_org_name_uq").on(table.tenantId, table.orgId, table.name),
    tenantPathUq: uniqueIndex("dept_tenant_path_uq").on(table.tenantId, table.path),
    tenantParentIdx: index("dept_tenant_parent_idx").on(table.tenantId, table.parentId),
  })
);

export type Department = typeof departments.$inferSelect;
export type NewDepartment = typeof departments.$inferInsert;

