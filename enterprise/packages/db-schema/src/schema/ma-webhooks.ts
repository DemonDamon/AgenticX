/**
 * 托管 Webhook。ma_webhooks 只由 admin-console 写入，签名密钥只存信封密文。
 * ma_webhook_deliveries 只由 agent-runtime 写入；管理台只读展示，因此不加外键。
 */
import { boolean, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, varchar } from "drizzle-orm/pg-core";

import { auditColumns, ulid } from "./_shared";
import { tenants } from "./tenants";

export const maWebhooks = pgTable(
  "ma_webhooks",
  {
    id: ulid("id").primaryKey(),
    tenantId: ulid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 120 }).notNull(),
    description: text("description").notNull().default(""),
    url: varchar("url", { length: 2048 }).notNull(),
    eventTypes: jsonb("event_types").notNull().default([]).$type<string[]>(),
    agentIds: jsonb("agent_ids").notNull().default([]).$type<string[]>(),
    sources: jsonb("sources").notNull().default([]).$type<string[]>(),
    includeResultText: boolean("include_result_text").notNull().default(false),
    enabled: boolean("enabled").notNull().default(true),
    disabledReason: varchar("disabled_reason", { length: 64 }),
    disabledAt: timestamp("disabled_at", { withTimezone: true }),
    failureResetAt: timestamp("failure_reset_at", { withTimezone: true }),
    secretCiphertext: text("secret_ciphertext").notNull(),
    wrappedDek: text("wrapped_dek").notNull(),
    kekId: varchar("kek_id", { length: 32 }).notNull(),
    secretRotatedAt: timestamp("secret_rotated_at", { withTimezone: true }),
    createdBy: varchar("created_by", { length: 26 }),
    ...auditColumns,
  },
  (table) => ({
    tenantNameUq: uniqueIndex("ma_webhooks_tenant_name_uq").on(table.tenantId, table.name),
  }),
);

export const maWebhookDeliveries = pgTable(
  "ma_webhook_deliveries",
  {
    id: ulid("id").primaryKey(),
    tenantId: ulid("tenant_id").notNull(),
    webhookId: ulid("webhook_id").notNull(),
    eventId: ulid("event_id").notNull(),
    eventType: varchar("event_type", { length: 32 }).notNull(),
    eventKey: varchar("event_key", { length: 160 }).notNull(),
    payload: jsonb("payload").notNull().$type<Record<string, unknown>>(),
    status: varchar("status", { length: 16 }).notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull(),
    lockedUntil: timestamp("locked_until", { withTimezone: true }),
    lastStatusCode: integer("last_status_code"),
    lastError: varchar("last_error", { length: 500 }),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    ...auditColumns,
  },
  (table) => ({
    eventUq: uniqueIndex("ma_webhook_deliveries_event_uq").on(table.webhookId, table.eventKey),
    dueIdx: index("ma_webhook_deliveries_due_idx").on(table.status, table.nextAttemptAt),
    webhookIdx: index("ma_webhook_deliveries_webhook_idx").on(table.tenantId, table.webhookId, table.createdAt),
  }),
);

export type MaWebhookRow = typeof maWebhooks.$inferSelect;
export type MaWebhookDeliveryRow = typeof maWebhookDeliveries.$inferSelect;
