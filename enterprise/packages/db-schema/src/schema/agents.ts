/**
 * 企业 Agent 注册表。管理员登记名称、模型、提示词、绑定的 Skill/MCP、
 * 运行方式与可见范围；协作房间后续按这张表把 Agent 加为成员。
 *
 * 能力引用沿用 `mcp:<ulid>` / `skill:<ulid>`。可见范围沿用
 * `all` / 用户 ulid / `email:<x>` / `dept:<id>` / `group:<ulid>`。
 */
import { index, jsonb, pgTable, text, uniqueIndex, varchar } from "drizzle-orm/pg-core";

import { auditColumns, ulid } from "./_shared";
import { tenants } from "./tenants";

export const enterpriseAgents = pgTable(
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
    /**
     * 与门户模型选择器同一格式：`<providerId>/<modelName>`。
     * 见 web-portal `PortalModelOption.id`（`admin-providers-reader.ts` 里
     * `flattenEnabledModelIds` / `listAvailableModelsForUser` 拼出来的 id）。
     */
    model: varchar("model", { length: 160 }).notNull(),
    /** 只允许 `cloud` 与 `desktop_worker`。 */
    runtime: varchar("runtime", { length: 24 }).notNull().default("cloud"),
    capabilityIds: text("capability_ids").array().notNull().default([]),
    assignmentKeys: text("assignment_keys").array().notNull().default(["all"]),
    /** 可承接桌面执行的员工，键格式同 assignment_keys。空数组表示没有人能承接。 */
    workerKeys: text("worker_keys").array().notNull().default([]),
    /** `active` / `disabled`。 */
    status: varchar("status", { length: 16 }).notNull().default("active"),
    metadata: jsonb("metadata").notNull().default({}).$type<Record<string, unknown>>(),
    ...auditColumns,
  },
  (table) => ({
    tenantSlugUq: uniqueIndex("enterprise_agents_tenant_slug_uq").on(table.tenantId, table.slug),
    tenantStatusIdx: index("enterprise_agents_tenant_status_idx").on(table.tenantId, table.status),
  }),
);

export type EnterpriseAgentRow = typeof enterpriseAgents.$inferSelect;
export type NewEnterpriseAgentRow = typeof enterpriseAgents.$inferInsert;
