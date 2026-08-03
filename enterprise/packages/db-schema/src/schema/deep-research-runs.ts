import { index, integer, jsonb, pgTable, text, timestamp, varchar } from "drizzle-orm/pg-core";

/** Portal deep-research run lifecycle (async execution + reconnect). */
export const enterpriseDeepResearchRuns = pgTable(
  "enterprise_deep_research_runs",
  {
    runId: varchar("run_id", { length: 26 }).primaryKey(),
    tenantId: varchar("tenant_id", { length: 26 }).notNull(),
    userId: varchar("user_id", { length: 26 }).notNull(),
    sessionId: varchar("session_id", { length: 26 }).notNull(),
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
  }),
);
