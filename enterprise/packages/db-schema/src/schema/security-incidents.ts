import { index, pgTable, text, timestamp, varchar } from "drizzle-orm/pg-core";

import { auditColumns, ulid } from "./_shared";

/**
 * SP5 incident-response-loop：安全事件记录（三态状态机 open → handling → resolved）。
 * 事件经 console 立案与流转；traceId 关联网关防篡改审计链；处置动作明细见
 * security_incident_actions。不做工单系统——三态足够（MASTER-PLAN 第四节第 4 条）。
 */
export const securityIncidents = pgTable(
  "security_incidents",
  {
    id: ulid("id").primaryKey(),
    tenantId: varchar("tenant_id", { length: 26 }).notNull(),
    title: varchar("title", { length: 256 }).notNull(),
    /** manual | policy_hit | budget_alert | chain_check | moderation */
    source: varchar("source", { length: 32 }).notNull().default("manual"),
    /** critical | high | medium | low */
    severity: varchar("severity", { length: 16 }).notNull().default("high"),
    /** open | handling | resolved（合法边：open→handling、handling→resolved、resolved→handling 重开） */
    status: varchar("status", { length: 16 }).notNull().default("open"),
    /** 关联网关审计链下钻键 */
    traceId: varchar("trace_id", { length: 128 }),
    sessionId: varchar("session_id", { length: 160 }),
    userId: varchar("user_id", { length: 128 }),
    model: varchar("model", { length: 128 }),
    summary: text("summary"),
    createdBy: varchar("created_by", { length: 128 }),
    handledAt: timestamp("handled_at", { withTimezone: true }),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    resolutionNote: text("resolution_note"),
    ...auditColumns,
  },
  (table) => [
    index("security_incidents_tenant_status_idx").on(table.tenantId, table.status),
    index("security_incidents_tenant_trace_idx").on(table.tenantId, table.traceId),
  ],
);

/** 处置动作明细：每个动作（含 disable_user 展开的子动作）独立留痕，可回滚对账。 */
export const securityIncidentActions = pgTable(
  "security_incident_actions",
  {
    id: ulid("id").primaryKey(),
    incidentId: ulid("incident_id").notNull(),
    tenantId: varchar("tenant_id", { length: 26 }).notNull(),
    /** terminate_session | revoke_pat | disable_user | block_model */
    actionType: varchar("action_type", { length: 32 }).notNull(),
    /** session | pat | user | model */
    targetType: varchar("target_type", { length: 16 }).notNull(),
    targetId: varchar("target_id", { length: 160 }),
    actorUserId: varchar("actor_user_id", { length: 128 }),
    detail: text("detail"),
    /** done | failed */
    outcome: varchar("outcome", { length: 16 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("security_incident_actions_incident_idx").on(table.incidentId)],
);
