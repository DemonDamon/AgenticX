/**
 * 托管 Webhook（MySQL）。ma_webhooks 只由 admin-console 写入，签名密钥只存信封密文。
 * ma_webhook_deliveries 只由 agent-runtime 写入；管理台只读展示，因此不加外键。
 */
import { boolean, datetime, index, int, json, mysqlTable, text, uniqueIndex, varchar } from "drizzle-orm/mysql-core";

import { auditColumns, ulid } from "./_shared";
import { tenants } from "./tenants";

export const maWebhooks = mysqlTable(
  "ma_webhooks",
  {
    id: ulid("id").primaryKey(),
    tenantId: ulid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 120 }).notNull(),
    description: varchar("description", { length: 2048 }).notNull().default(""),
    url: varchar("url", { length: 2048 }).notNull(),
    eventTypes: json("event_types").notNull().default([]).$type<string[]>(),
    agentIds: json("agent_ids").notNull().default([]).$type<string[]>(),
    sources: json("sources").notNull().default([]).$type<string[]>(),
    includeResultText: boolean("include_result_text").notNull().default(false),
    enabled: boolean("enabled").notNull().default(true),
    disabledReason: varchar("disabled_reason", { length: 64 }),
    disabledAt: datetime("disabled_at", { fsp: 6 }),
    failureResetAt: datetime("failure_reset_at", { fsp: 6 }),
    secretCiphertext: text("secret_ciphertext").notNull(),
    wrappedDek: text("wrapped_dek").notNull(),
    kekId: varchar("kek_id", { length: 32 }).notNull(),
    secretRotatedAt: datetime("secret_rotated_at", { fsp: 6 }),
    createdBy: varchar("created_by", { length: 26 }),
    ...auditColumns,
  },
  (table) => ({
    tenantNameUq: uniqueIndex("ma_webhooks_tenant_name_uq").on(table.tenantId, table.name),
  }),
);

export const maWebhookDeliveries = mysqlTable(
  "ma_webhook_deliveries",
  {
    id: ulid("id").primaryKey(),
    tenantId: ulid("tenant_id").notNull(),
    webhookId: ulid("webhook_id").notNull(),
    eventId: ulid("event_id").notNull(),
    eventType: varchar("event_type", { length: 32 }).notNull(),
    eventKey: varchar("event_key", { length: 160 }).notNull(),
    payload: json("payload").notNull().$type<Record<string, unknown>>(),
    status: varchar("status", { length: 16 }).notNull().default("pending"),
    attempts: int("attempts").notNull().default(0),
    nextAttemptAt: datetime("next_attempt_at", { fsp: 6 }).notNull(),
    lockedUntil: datetime("locked_until", { fsp: 6 }),
    lastStatusCode: int("last_status_code"),
    lastError: varchar("last_error", { length: 500 }),
    deliveredAt: datetime("delivered_at", { fsp: 6 }),
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
