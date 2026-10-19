import { index, jsonb, pgTable, text, timestamp, varchar } from "drizzle-orm/pg-core";

import { auditColumns, ulid } from "./_shared";
import { tenants } from "./tenants";
import { users } from "./users";

export type EnterpriseProjectSettings = {
  connectors: string[];
  experts: string[];
  skills: string[];
};

export const enterpriseProjects = pgTable(
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
    settings: jsonb("settings").$type<EnterpriseProjectSettings>(),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
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
