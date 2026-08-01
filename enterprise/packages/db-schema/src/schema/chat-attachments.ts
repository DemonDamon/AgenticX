import { bigint, index, pgTable, text, timestamp, varchar } from "drizzle-orm/pg-core";

/** Portal chat original-file attachments (binary on blob store, metadata in DB). */
export const enterpriseChatAttachments = pgTable(
  "enterprise_chat_attachments",
  {
    id: varchar("id", { length: 26 }).primaryKey(),
    tenantId: varchar("tenant_id", { length: 26 }).notNull(),
    userId: varchar("user_id", { length: 26 }).notNull(),
    /** Nullable until the attachment is bound to a persisted chat session. */
    sessionId: varchar("session_id", { length: 26 }),
    fileName: text("file_name").notNull(),
    mimeType: varchar("mime_type", { length: 128 }).notNull(),
    byteSize: bigint("byte_size", { mode: "number" }).notNull(),
    kind: varchar("kind", { length: 32 }).default("document").notNull(),
    /** "fs" | "s3" — only fs is implemented in this wave. */
    storageDriver: varchar("storage_driver", { length: 16 }).default("fs").notNull(),
    /** Relative path under the blob root for the fs driver. */
    storageKey: text("storage_key").notNull(),
    /** sha256 hex digest for integrity / dedup. */
    checksum: varchar("checksum", { length: 64 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
  },
  (table) => ({
    ownerIdx: index("enterprise_chat_attachments_owner_idx").on(
      table.tenantId,
      table.userId,
      table.createdAt,
    ),
    sessionIdx: index("enterprise_chat_attachments_session_idx").on(
      table.tenantId,
      table.sessionId,
    ),
  }),
);
