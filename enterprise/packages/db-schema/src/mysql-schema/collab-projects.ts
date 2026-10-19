import { datetime, index, json, mysqlTable, text, varchar } from "drizzle-orm/mysql-core";

import { auditColumns, ulid } from "./_shared";
import { tenants } from "./tenants";
import { users } from "./users";

export type EnterpriseProjectSettings = {
  connectors: string[];
  experts: string[];
  skills: string[];
};

export const enterpriseProjects = mysqlTable(
  "enterprise_projects",
  {
    id: ulid("id").primaryKey(),
    tenantId: ulid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 32 }).notNull(),
    instructions: text("instructions"),
    ownerUserId: ulid("owner_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    deptId: ulid("dept_id"),
    mainRoomId: ulid("main_room_id"),
    settings: json("settings").$type<EnterpriseProjectSettings>(),
    archivedAt: datetime("archived_at", { fsp: 6 }),
    ...auditColumns,
  },
  (table) => ({
    tenantUpdatedIdx: index("enterprise_projects_tenant_updated_idx").on(
      table.tenantId,
      table.updatedAt,
    ),
    tenantDeptIdx: index("enterprise_projects_tenant_dept_idx").on(table.tenantId, table.deptId),
  }),
);

export type EnterpriseProjectRow = typeof enterpriseProjects.$inferSelect;
export type NewEnterpriseProjectRow = typeof enterpriseProjects.$inferInsert;
