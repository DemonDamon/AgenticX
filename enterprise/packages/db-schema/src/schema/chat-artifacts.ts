import { integer, pgTable, text, timestamp, uniqueIndex, varchar, index } from "drizzle-orm/pg-core";

/** Portal deep-research artifacts (session-scoped logical paths). */
export const enterpriseChatArtifacts = pgTable(
  "enterprise_chat_artifacts",
  {
    id: varchar("id", { length: 26 }).primaryKey(),
    tenantId: varchar("tenant_id", { length: 26 }).notNull(),
    userId: varchar("user_id", { length: 26 }).notNull(),
    sessionId: varchar("session_id", { length: 26 }).notNull(),
    runId: varchar("run_id", { length: 26 }).notNull(),
    path: text("path").notNull(),
    title: text("title").notNull(),
    kind: varchar("kind", { length: 32 }).default("other").notNull(),
    mimeType: varchar("mime_type", { length: 128 }).default("text/markdown").notNull(),
    content: text("content").notNull(),
    byteSize: integer("byte_size").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    sessionPathUk: uniqueIndex("enterprise_chat_artifacts_session_path_uk").on(
      table.sessionId,
      table.path,
    ),
    sessionIdx: index("enterprise_chat_artifacts_session_idx").on(
      table.tenantId,
      table.sessionId,
      table.createdAt,
    ),
  }),
);
