/** 托管智能体「用户 × 智能体」token 配额。只由 admin-console 写入。 */
import { bigint, pgTable, uniqueIndex, varchar } from "drizzle-orm/pg-core";

import { enterpriseAgents } from "./agents";
import { auditColumns, ulid } from "./_shared";
import { tenants } from "./tenants";

export const maAgentQuotas = pgTable(
  "ma_agent_quotas",
  {
    id: ulid("id").primaryKey(),
    tenantId: ulid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    agentId: ulid("agent_id").notNull().references(() => enterpriseAgents.id, { onDelete: "cascade" }),
    subjectKey: varchar("subject_key", { length: 40 }).notNull(),
    userId: varchar("user_id", { length: 26 }),
    dailyTokens: bigint("daily_tokens", { mode: "number" }).notNull().default(0),
    weeklyTokens: bigint("weekly_tokens", { mode: "number" }).notNull().default(0),
    monthlyTokens: bigint("monthly_tokens", { mode: "number" }).notNull().default(0),
    createdBy: varchar("created_by", { length: 26 }),
    ...auditColumns,
  },
  (table) => ({
    subjectUq: uniqueIndex("ma_agent_quotas_subject_uq").on(table.tenantId, table.agentId, table.subjectKey),
  }),
);

export type MaAgentQuotaRow = typeof maAgentQuotas.$inferSelect;
