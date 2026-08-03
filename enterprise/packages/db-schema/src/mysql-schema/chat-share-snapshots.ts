import { sql } from "drizzle-orm";
import { datetime, index, json, mysqlTable, varchar } from "drizzle-orm/mysql-core";

/** Immutable, user-selected chat snapshots behind opaque share tokens. */
export const chatShareSnapshots = mysqlTable(
  "chat_share_snapshots",
  {
    token: varchar("token", { length: 64 }).primaryKey(),
    sessionId: varchar("session_id", { length: 26 }).notNull(),
    tenantId: varchar("tenant_id", { length: 26 }).notNull(),
    userId: varchar("user_id", { length: 26 }).notNull(),
    title: varchar("title", { length: 160 }).notNull(),
    messages: json("messages").notNull(),
    createdAt: datetime("created_at", { fsp: 6 }).default(sql`(UTC_TIMESTAMP(6))`).notNull(),
    revokedAt: datetime("revoked_at", { fsp: 6 }),
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
