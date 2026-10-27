/** 企业 Agent 的不可变版本。行一旦写入不再更新；(agent_id, version) 唯一。 */
import { index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, varchar } from "drizzle-orm/pg-core";

import { enterpriseAgents } from "./agents";
import { ulid } from "./_shared";

export const enterpriseAgentVersions = pgTable(
  "enterprise_agent_versions",
  {
    id: ulid("id").primaryKey(),
    tenantId: ulid("tenant_id").notNull(),
    agentId: ulid("agent_id").notNull().references(() => enterpriseAgents.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    /** 规范化后的 agx.agent/v1 manifest。 */
    manifest: jsonb("manifest").notNull().$type<Record<string, unknown>>(),
    /** `sha256:<64 hex>`，由 core-api manifestHash 计算。 */
    manifestHash: varchar("manifest_hash", { length: 80 }).notNull(),
    note: text("note"),
    /** backfill / admin / api / legacy_edit / desktop */
    source: varchar("source", { length: 16 }).notNull().default("admin"),
    createdBy: varchar("created_by", { length: 26 }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    agentVersionUq: uniqueIndex("enterprise_agent_versions_agent_version_uq").on(table.agentId, table.version),
    tenantAgentIdx: index("enterprise_agent_versions_tenant_agent_idx").on(table.tenantId, table.agentId, table.createdAt),
  }),
);

export type EnterpriseAgentVersionRow = typeof enterpriseAgentVersions.$inferSelect;
export type NewEnterpriseAgentVersionRow = typeof enterpriseAgentVersions.$inferInsert;
