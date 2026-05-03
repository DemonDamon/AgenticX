import { index, integer, pgTable, timestamp, uniqueIndex, varchar } from "drizzle-orm/pg-core";
import { auditColumns, softDeleteColumns, ulid } from "./_shared";
import { departments } from "./departments";
import { tenants } from "./tenants";

export const users = pgTable(
  "users",
  {
    id: ulid("id").primaryKey(),
    tenantId: ulid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "restrict" }),
    deptId: ulid("dept_id").references(() => departments.id, { onDelete: "set null" }),
    email: varchar("email", { length: 320 }).notNull(),
    displayName: varchar("display_name", { length: 128 }).notNull(),
    passwordHash: varchar("password_hash", { length: 255 }).notNull(),
    status: varchar("status", { length: 32 }).notNull().default("active"),
    phone: varchar("phone", { length: 32 }),
    employeeNo: varchar("employee_no", { length: 64 }),
    jobTitle: varchar("job_title", { length: 128 }),
    failedLoginCount: integer("failed_login_count").notNull().default(0),
    lockedUntil: timestamp("locked_until", { withTimezone: true }),
    ...softDeleteColumns,
    ...auditColumns,
  },
  (table) => ({
    tenantEmailUq: uniqueIndex("users_tenant_email_uq").on(table.tenantId, table.email),
    idTenantUq: uniqueIndex("users_id_tenant_uq").on(table.id, table.tenantId),
    tenantDeptIdx: index("users_tenant_dept_idx").on(table.tenantId, table.deptId),
    tenantEmployeeNoIdx: index("users_tenant_employee_no_idx").on(table.tenantId, table.employeeNo),
  })
);

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;

