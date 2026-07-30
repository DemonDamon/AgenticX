import { index, pgTable, timestamp, varchar } from "drizzle-orm/pg-core";
import { ulid } from "./_shared";

/** Idempotency ledger for portal chat history append operations. */
export const chatHistoryOperations = pgTable(
  "chat_history_operations",
  {
    operationId: ulid("operation_id").primaryKey(),
    tenantId: ulid("tenant_id").notNull(),
    userId: ulid("user_id").notNull(),
    sessionId: ulid("session_id").notNull(),
    payloadHash: varchar("payload_hash", { length: 64 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    tenantUserSessionIdx: index("chat_history_operations_tenant_user_session_idx").on(
      table.tenantId,
      table.userId,
      table.sessionId,
    ),
  }),
);

export type ChatHistoryOperationRow = typeof chatHistoryOperations.$inferSelect;
export type NewChatHistoryOperationRow = typeof chatHistoryOperations.$inferInsert;
