/**
 * 企业 Agent 注册表（MySQL）。
 *
 * `capability_ids` / `assignment_keys` / `worker_keys` 在此方言下落为 json，写法同
 * `enterprise_skills.required_capabilities`。
 *
 * `model` 与门户模型选择器同一格式：`<providerId>/<modelName>`
 * （web-portal `PortalModelOption.id`）。
 */
import { index, json, mysqlTable, text, uniqueIndex, varchar } from "drizzle-orm/mysql-core";

import { auditColumns, ulid } from "./_shared";
import { tenants } from "./tenants";

export const enterpriseAgents = mysqlTable(
  "enterprise_agents",
  {
    id: ulid("id").primaryKey(),
    tenantId: ulid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    slug: varchar("slug", { length: 64 }).notNull(),
    displayName: varchar("display_name", { length: 64 }).notNull(),
    description: text("description"),
    systemPrompt: text("system_prompt").notNull().default(""),
    model: varchar("model", { length: 160 }).notNull(),
    runtime: varchar("runtime", { length: 24 }).notNull().default("cloud"),
    capabilityIds: json("capability_ids").$type<string[]>().notNull().default([]),
    assignmentKeys: json("assignment_keys").$type<string[]>().notNull().default(["all"]),
    /** 可承接桌面执行的员工，键格式同 assignment_keys。空数组表示没有人能承接。 */
    workerKeys: json("worker_keys").$type<string[]>().notNull().default([]),
    status: varchar("status", { length: 16 }).notNull().default("active"),
    metadata: json("metadata").notNull().default({}).$type<Record<string, unknown>>(),
    ...auditColumns,
  },
  (table) => ({
    tenantSlugUq: uniqueIndex("enterprise_agents_tenant_slug_uq").on(table.tenantId, table.slug),
    tenantStatusIdx: index("enterprise_agents_tenant_status_idx").on(table.tenantId, table.status),
  }),
);

export type EnterpriseAgentRow = typeof enterpriseAgents.$inferSelect;
export type NewEnterpriseAgentRow = typeof enterpriseAgents.$inferInsert;
