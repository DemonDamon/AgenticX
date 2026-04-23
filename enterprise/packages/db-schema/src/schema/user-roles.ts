import { index, pgTable, primaryKey } from "drizzle-orm/pg-core";
import { auditColumns, ulid } from "./_shared";
import { departments } from "./departments";
import { organizations } from "./organizations";
import { roles } from "./roles";
import { tenants } from "./tenants";
import { users } from "./users";

export const userRoles = pgTable(
  "user_roles",
  {
    tenantId: ulid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "restrict" }),
    userId: ulid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    roleId: ulid("role_id")
      .notNull()
      .references(() => roles.id, { onDelete: "cascade" }),
    scopeOrgId: ulid("scope_org_id").references(() => organizations.id, { onDelete: "set null" }),
    scopeDeptId: ulid("scope_dept_id").references(() => departments.id, { onDelete: "set null" }),
    ...auditColumns,
  },
  (table) => ({
    pk: primaryKey({ columns: [table.tenantId, table.userId, table.roleId], name: "user_roles_pk" }),
    tenantUserIdx: index("user_roles_tenant_user_idx").on(table.tenantId, table.userId),
  })
);

export type UserRole = typeof userRoles.$inferSelect;
export type NewUserRole = typeof userRoles.$inferInsert;

