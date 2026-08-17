import { index, integer, jsonb, pgTable, text, timestamp, varchar } from "drizzle-orm/pg-core";

/** Portal deep-research run lifecycle (async execution + reconnect). */
export const enterpriseDeepResearchRuns = pgTable(
  "enterprise_deep_research_runs",
  {
    runId: varchar("run_id", { length: 26 }).primaryKey(),
    tenantId: varchar("tenant_id", { length: 26 }).notNull(),
    userId: varchar("user_id", { length: 26 }).notNull(),
    sessionId: varchar("session_id", { length: 26 }).notNull(),
    /** 关联的请求 trace_id（ULID，长度 26；列宽按主规划统一 128）。可为空：老数据与非 trace 链路。 */
    traceId: varchar("trace_id", { length: 128 }),
    /** running | awaiting_clarify | completed | failed | cancelled */
    status: varchar("status", { length: 32 }).default("running").notNull(),
    /** recon | clarify | plan | lanes | reflect | synthesize | done */
    phase: varchar("phase", { length: 32 }).default("recon").notNull(),
    topic: text("topic").notNull(),
    /** 有序 DeepResearchEvent[]，重连时全量重放。 */
    events: jsonb("events").$type<unknown[]>().default([]).notNull(),
    /** 已产出的报告 Markdown（增量追加），完成前可为部分内容。 */
    reportMarkdown: text("report_markdown").default("").notNull(),
    /** 序列化的 Citation[]，用于 sources 段重放。 */
    citations: jsonb("citations").$type<unknown[]>().default([]).notNull(),
    errorMessage: text("error_message"),
    eventSeq: integer("event_seq").default(0).notNull(),
    /** 乐观锁版本号：跨实例写入用 run_id + revision 做 CAS。 */
    revision: integer("revision").default(0).notNull(),
    /** 澄清应答（ClarifyResumePayload），DB 是跨实例澄清协调的唯一事实源。 */
    clarifyResume: jsonb("clarify_resume").$type<unknown>(),
    /** 澄清等待到期时间；超时后由 expireClarification 原子写入跳过应答。 */
    clarifyExpiresAt: timestamp("clarify_expires_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    sessionIdx: index("enterprise_deep_research_runs_session_idx").on(
      table.tenantId,
      table.sessionId,
      table.createdAt,
    ),
    statusIdx: index("enterprise_deep_research_runs_status_idx").on(
      table.tenantId,
      table.status,
      table.updatedAt,
    ),
    traceIdx: index("enterprise_deep_research_runs_trace_idx").on(table.tenantId, table.traceId),
  }),
);
