import { index, mysqlTable, text, timestamp, varchar } from "drizzle-orm/mysql-core";
import { sql } from "drizzle-orm";

import { auditColumns, ulid } from "./_shared";

/**
 * SP5 incident-response-loop：安全事件记录（三态状态机 open → handling → resolved）。
 * 与 PostgreSQL 版 security_incidents 保持 parity（schema-parity.test.ts）。
 */
export const securityIncidents = mysqlTable(
  "security_incidents",
  {
    id: ulid("id").primaryKey(),
    tenantId: varchar("tenant_id", { length: 26 }).notNull(),
    title: varchar("title", { length: 256 }).notNull(),
    source: varchar("source", { length: 32 }).notNull().default("manual"),
    severity: varchar("severity", { length: 16 }).notNull().default("high"),
    status: varchar("status", { length: 16 }).notNull().default("open"),
    traceId: varchar("trace_id", { length: 128 }),
    sessionId: varchar("session_id", { length: 160 }),
    userId: varchar("user_id", { length: 128 }),
    model: varchar("model", { length: 128 }),
    summary: text("summary"),
    createdBy: varchar("created_by", { length: 128 }),
    handledAt: timestamp("handled_at", { fsp: 6 }),
    resolvedAt: timestamp("resolved_at", { fsp: 6 }),
    resolutionNote: text("resolution_note"),
    ...auditColumns,
  },
  (table) => [
    index("security_incidents_tenant_status_idx").on(table.tenantId, table.status),
    index("security_incidents_tenant_trace_idx").on(table.tenantId, table.traceId),
  ],
);

/** 处置动作明细：每个动作独立留痕，可回滚对账。 */
export const securityIncidentActions = mysqlTable(
  "security_incident_actions",
  {
    id: ulid("id").primaryKey(),
    incidentId: ulid("incident_id").notNull(),
    tenantId: varchar("tenant_id", { length: 26 }).notNull(),
    actionType: varchar("action_type", { length: 32 }).notNull(),
    targetType: varchar("target_type", { length: 16 }).notNull(),
    targetId: varchar("target_id", { length: 160 }),
    actorUserId: varchar("actor_user_id", { length: 128 }),
    detail: text("detail"),
    outcome: varchar("outcome", { length: 16 }).notNull(),
    createdAt: timestamp("created_at", { fsp: 6 }).default(sql`(UTC_TIMESTAMP(6))`).notNull(),
  },
  (table) => [index("security_incident_actions_incident_idx").on(table.incidentId)],
);
