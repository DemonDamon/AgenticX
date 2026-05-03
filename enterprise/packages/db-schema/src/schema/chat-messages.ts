import { index, jsonb, pgTable, text, varchar } from "drizzle-orm/pg-core";
import { tenants } from "./tenants";
import { users } from "./users";
import { auditColumns, ulid } from "./_shared";
import { chatSessions } from "./chat-sessions";

export const chatMessages = pgTable(
  "chat_messages",
  {
    id: ulid("id").primaryKey(),
    sessionId: ulid("session_id")
      .notNull()
      .references(() => chatSessions.id, { onDelete: "restrict" }),
    tenantId: ulid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "restrict" }),
    userId: ulid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    role: varchar("role", { length: 32 }).notNull(),
    content: text("content").notNull(),
    model: varchar("model", { length: 160 }),
    status: varchar("status", { length: 32 }).notNull().default("complete"),
    metadata: jsonb("metadata"),
    ...auditColumns,
  },
  (table) => ({
    sessionCreatedIdx: index("chat_messages_session_created_idx").on(table.sessionId, table.createdAt),
    tenantUserSessionIdx: index("chat_messages_tenant_user_session_idx").on(
      table.tenantId,
      table.userId,
      table.sessionId
    ),
  })
);

export type ChatMessageRow = typeof chatMessages.$inferSelect;
export type NewChatMessageRow = typeof chatMessages.$inferInsert;
