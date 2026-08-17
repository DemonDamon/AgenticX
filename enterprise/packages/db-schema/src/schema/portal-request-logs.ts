import { index, integer, jsonb, pgTable, text, timestamp, varchar } from "drizzle-orm/pg-core";
import { auditColumns, ulid } from "./_shared";

/** Portal BFF structured request logs (ops triage; not a compliance audit chain). */
export const portalRequestLogs = pgTable(
  "portal_request_logs",
  {
    id: ulid("id").primaryKey(),
    tenantId: varchar("tenant_id", { length: 64 }).notNull(),
    logTime: timestamp("log_time", { withTimezone: true }).notNull(),
    level: varchar("level", { length: 16 }).notNull(),
    event: varchar("event", { length: 128 }).notNull(),
    traceId: varchar("trace_id", { length: 128 }),
    userId: varchar("user_id", { length: 128 }),
    sessionId: varchar("session_id", { length: 128 }),
    route: varchar("route", { length: 128 }),
    /** 对话形态：chat | deep_research | web_search；写日志时决定，勿按 route 反推。 */
    mode: varchar("mode", { length: 32 }),
    /** 深度调研 run_id（ULID）；同一次调研的多条请求日志共享。 */
    runId: varchar("run_id", { length: 64 }),
    status: integer("status"),
    durationMs: integer("duration_ms"),
    errorName: varchar("error_name", { length: 128 }),
    errorMessage: text("error_message"),
    errorStack: text("error_stack"),
    fields: jsonb("fields").$type<Record<string, unknown>>(),
    ...auditColumns,
  },
  (table) => ({
    tenantTraceIdx: index("portal_request_logs_tenant_trace_idx").on(table.tenantId, table.traceId),
    tenantTimeIdx: index("portal_request_logs_tenant_time_idx").on(table.tenantId, table.logTime),
    tenantUserTimeIdx: index("portal_request_logs_tenant_user_time_idx").on(
      table.tenantId,
      table.userId,
      table.logTime,
    ),
    tenantLevelTimeIdx: index("portal_request_logs_tenant_level_time_idx").on(
      table.tenantId,
      table.level,
      table.logTime,
    ),
    tenantModeTimeIdx: index("portal_request_logs_tenant_mode_time_idx").on(
      table.tenantId,
      table.mode,
      table.logTime,
    ),
    tenantRunIdx: index("portal_request_logs_tenant_run_idx").on(table.tenantId, table.runId),
    tenantSessionTimeIdx: index("portal_request_logs_tenant_session_time_idx").on(
      table.tenantId,
      table.sessionId,
      table.logTime,
    ),
  }),
);

export type PortalRequestLogRow = typeof portalRequestLogs.$inferSelect;
export type NewPortalRequestLogRow = typeof portalRequestLogs.$inferInsert;
