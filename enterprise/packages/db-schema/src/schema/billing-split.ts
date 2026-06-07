import { boolean, jsonb, pgTable, text, timestamp, varchar, bigint, index, uniqueIndex } from "drizzle-orm/pg-core";

export const billingSplitRules = pgTable(
  "billing_split_rules",
  {
    id: varchar("id", { length: 26 }).primaryKey(),
    tenantId: varchar("tenant_id", { length: 26 }).notNull(),
    name: varchar("name", { length: 128 }).notNull(),
    effectiveStart: timestamp("effective_start", { withTimezone: true }).notNull(),
    effectiveEnd: timestamp("effective_end", { withTimezone: true }),
    splitMode: varchar("split_mode", { length: 32 }).notNull().default("fixed_ratio"),
    participants: jsonb("participants").notNull(),
    billingItems: jsonb("billing_items"),
    enabled: boolean("enabled").default(true).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    tenantEffectiveIdx: index("billing_split_rules_tenant_effective_idx").on(
      table.tenantId,
      table.effectiveStart,
      table.effectiveEnd
    ),
  })
);

export const billingSplitLedger = pgTable(
  "billing_split_ledger",
  {
    id: varchar("id", { length: 26 }).primaryKey(),
    tenantId: varchar("tenant_id", { length: 26 }).notNull(),
    usageRecordId: varchar("usage_record_id", { length: 26 }).notNull(),
    ruleId: varchar("rule_id", { length: 26 }).notNull(),
    ruleVersion: varchar("rule_version", { length: 64 }).notNull(),
    participantId: varchar("participant_id", { length: 64 }).notNull(),
    participantLabel: varchar("participant_label", { length: 128 }),
    amountMicroUsd: bigint("amount_micro_usd", { mode: "bigint" }).notNull(),
    originalCostMicroUsd: bigint("original_cost_micro_usd", { mode: "bigint" }).notNull(),
    timeBucket: timestamp("time_bucket", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    usageParticipantUnique: uniqueIndex("billing_split_ledger_usage_participant_rule_idx").on(
      table.usageRecordId,
      table.participantId,
      table.ruleId
    ),
    tenantTimeIdx: index("billing_split_ledger_tenant_time_idx").on(table.tenantId, table.timeBucket),
    tenantParticipantIdx: index("billing_split_ledger_tenant_participant_idx").on(table.tenantId, table.participantId),
  })
);

export const billingSettlementWebhookConfig = pgTable("billing_settlement_webhook_config", {
  tenantId: varchar("tenant_id", { length: 26 }).primaryKey(),
  webhookUrl: text("webhook_url"),
  enabled: boolean("enabled").default(false).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const billingSettlementWebhookEvents = pgTable(
  "billing_settlement_webhook_events",
  {
    id: varchar("id", { length: 26 }).primaryKey(),
    tenantId: varchar("tenant_id", { length: 26 }).notNull(),
    payload: jsonb("payload").notNull(),
    status: varchar("status", { length: 32 }).notNull(),
    responseStatus: bigint("response_status", { mode: "number" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    tenantCreatedIdx: index("billing_settlement_webhook_events_tenant_idx").on(table.tenantId, table.createdAt),
  })
);
