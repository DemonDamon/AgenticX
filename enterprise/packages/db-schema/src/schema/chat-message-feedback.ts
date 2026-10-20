import { sql } from "drizzle-orm";
import { check, foreignKey, index, pgTable, text, uniqueIndex, varchar } from "drizzle-orm/pg-core";

import { auditColumns, ulid } from "./_shared";
import { chatMessages } from "./chat-messages";
import { chatSessions } from "./chat-sessions";
import { tenants } from "./tenants";
import { users } from "./users";

/** The latest useful/not-useful vote a user gave to one assistant message. */
export const CHAT_FEEDBACK_SOURCES = ["web", "desktop"] as const;
export type ChatFeedbackSource = (typeof CHAT_FEEDBACK_SOURCES)[number];

export const chatMessageFeedback = pgTable(
  "chat_message_feedback",
  {
    id: ulid("id").primaryKey(),
    tenantId: ulid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    userId: ulid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    /** Snapshot of the user's department when the vote was submitted. */
    departmentId: ulid("department_id"),
    // Web feedback keeps the durable chat FKs. Desktop feedback targets a
    // local message which is intentionally not mirrored into chat_sessions or
    // chat_messages, so these two columns are nullable for that source.
    sessionId: ulid("session_id").references(() => chatSessions.id, { onDelete: "restrict" }),
    messageId: ulid("message_id").references(() => chatMessages.id, { onDelete: "cascade" }),
    value: varchar("value", { length: 16 }).$type<"like" | "dislike">().notNull(),
    source: varchar("source", { length: 16 })
      .$type<ChatFeedbackSource>()
      .notNull()
      .default("web"),
    /** Stable identifiers from a desktop-local session/message store. */
    externalSessionId: varchar("external_session_id", { length: 128 }),
    externalMessageId: varchar("external_message_id", { length: 128 }),
    /** Immutable-at-write snapshots used for model/provider reporting. */
    traceId: varchar("trace_id", { length: 128 }),
    provider: varchar("provider", { length: 128 }),
    model: varchar("model", { length: 160 }),
    /** Bounded answer snapshot used when no durable chat message exists. */
    answerExcerpt: text("answer_excerpt"),
    ...auditColumns,
  },
  (table) => ({
    valueCheck: check(
      "chat_message_feedback_value_check",
      sql`${table.value} in ('like', 'dislike')`,
    ),
    sourceCheck: check(
      "chat_message_feedback_source_check",
      sql`${table.source} in ('web', 'desktop')`,
    ),
    sourceIdentityCheck: check(
      "chat_message_feedback_source_identity_check",
      sql`(
        (${table.source} = 'web' and ${table.sessionId} is not null and ${table.messageId} is not null
          and ${table.externalSessionId} is null and ${table.externalMessageId} is null)
        or
        (${table.source} = 'desktop' and ${table.sessionId} is null and ${table.messageId} is null
          and ${table.externalSessionId} is not null and ${table.externalMessageId} is not null)
      )`,
    ),
    tenantUserMessageUq: uniqueIndex("chat_message_feedback_tenant_user_message_uq").on(
      table.tenantId,
      table.userId,
      table.messageId,
    ),
    tenantMessageValueIdx: index("chat_message_feedback_tenant_message_value_idx").on(
      table.tenantId,
      table.messageId,
      table.value,
    ),
    tenantDepartmentCreatedIdx: index("chat_message_feedback_tenant_department_created_idx").on(
      table.tenantId,
      table.departmentId,
      table.createdAt,
    ),
    tenantModelCreatedIdx: index("chat_message_feedback_tenant_model_created_idx").on(
      table.tenantId,
      table.model,
      table.createdAt,
    ),
    tenantSourceExternalIdentityUq: uniqueIndex(
      "chat_message_feedback_tenant_source_external_identity_uq",
    ).on(table.tenantId, table.userId, table.source, table.externalSessionId, table.externalMessageId),
    sessionTenantUserFk: foreignKey({
      name: "chat_message_feedback_session_tenant_user_fk",
      columns: [table.sessionId, table.tenantId, table.userId],
      foreignColumns: [chatSessions.id, chatSessions.tenantId, chatSessions.userId],
    }).onDelete("restrict"),
  }),
);

export type ChatMessageFeedbackRow = typeof chatMessageFeedback.$inferSelect;
export type NewChatMessageFeedbackRow = typeof chatMessageFeedback.$inferInsert;
