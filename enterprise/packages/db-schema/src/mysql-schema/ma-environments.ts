/**
 * 托管智能体执行环境（MySQL）。type 只有 cloud / desktop_worker。
 * config 结构见 core-api managed-agents 的 EnvironmentConfig（含 type 判别键）。
 */
import { index, json, mysqlTable, text, uniqueIndex, varchar } from "drizzle-orm/mysql-core";

import { auditColumns, ulid } from "./_shared";
import { tenants } from "./tenants";

export const maEnvironments = mysqlTable(
  "ma_environments",
  {
    id: ulid("id").primaryKey(),
    tenantId: ulid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 64 }).notNull(),
    description: text("description"),
    type: varchar("type", { length: 24 }).notNull(),
    config: json("config").notNull().default({}).$type<Record<string, unknown>>(),
    status: varchar("status", { length: 16 }).notNull().default("active"),
    createdBy: varchar("created_by", { length: 26 }),
    ...auditColumns,
  },
  (table) => ({
    tenantNameUq: uniqueIndex("ma_environments_tenant_name_uq").on(table.tenantId, table.name),
    tenantStatusIdx: index("ma_environments_tenant_status_idx").on(table.tenantId, table.status),
  }),
);

export type MaEnvironmentRow = typeof maEnvironments.$inferSelect;
export type NewMaEnvironmentRow = typeof maEnvironments.$inferInsert;
