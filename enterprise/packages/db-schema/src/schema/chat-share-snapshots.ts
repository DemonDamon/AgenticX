import { index, jsonb, pgTable, timestamp, varchar } from "drizzle-orm/pg-core";

/** Immutable, user-selected chat snapshots behind opaque share tokens. */
export const chatShareSnapshots = pgTable(
  "chat_share_snapshots",
  {
    token: varchar("token", { length: 64 }).primaryKey(),
    sessionId: varchar("session_id", { length: 26 }).notNull(),
    tenantId: varchar("tenant_id", { length: 26 }).notNull(),
    userId: varchar("user_id", { length: 26 }).notNull(),
    title: varchar("title", { length: 160 }).notNull(),
    messages: jsonb("messages").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (table) => ({
    sessionIdx: index("chat_share_snapshots_session_idx").on(
      table.tenantId,
      table.userId,
      table.sessionId,
    ),
    createdIdx: index("chat_share_snapshots_created_idx").on(table.createdAt),
  }),
);

export type ChatShareSnapshotRow = typeof chatShareSnapshots.$inferSelect;
export type NewChatShareSnapshotRow = typeof chatShareSnapshots.$inferInsert;
