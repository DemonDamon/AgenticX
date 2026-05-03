import { index, integer, pgTable, timestamp, varchar } from "drizzle-orm/pg-core";
import { tenants } from "./tenants";
import { users } from "./users";
import { auditColumns, ulid } from "./_shared";

export const chatSessions = pgTable(
  "chat_sessions",
  {
    id: ulid("id").primaryKey(),
    tenantId: ulid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "restrict" }),
    userId: ulid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    title: varchar("title", { length: 160 }).notNull(),
    activeModel: varchar("active_model", { length: 160 }),
    messageCount: integer("message_count").notNull().default(0),
    lastMessageAt: timestamp("last_message_at", { withTimezone: true }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    ...auditColumns,
  },
  (table) => ({
    tenantUserUpdatedIdx: index("chat_sessions_tenant_user_updated_idx").on(
      table.tenantId,
      table.userId,
      table.updatedAt
    ),
    tenantUserDeletedIdx: index("chat_sessions_tenant_user_deleted_idx").on(
      table.tenantId,
      table.userId,
      table.deletedAt
    ),
  })
);

export type ChatSessionRow = typeof chatSessions.$inferSelect;
export type NewChatSessionRow = typeof chatSessions.$inferInsert;
