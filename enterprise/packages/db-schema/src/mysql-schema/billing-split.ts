import { sql } from "drizzle-orm";
import { boolean, json, mysqlTable, text, datetime, varchar, bigint, index, uniqueIndex } from "drizzle-orm/mysql-core";

export const billingSplitRules = mysqlTable(
  "billing_split_rules",
  {
    id: varchar("id", { length: 26 }).primaryKey(),
    tenantId: varchar("tenant_id", { length: 26 }).notNull(),
    name: varchar("name", { length: 128 }).notNull(),
    effectiveStart: datetime("effective_start", { fsp: 6 }).notNull(),
    effectiveEnd: datetime("effective_end", { fsp: 6 }),
    splitMode: varchar("split_mode", { length: 32 }).notNull().default("fixed_ratio"),
    participants: json("participants").notNull(),
    billingItems: json("billing_items"),
    enabled: boolean("enabled").default(true).notNull(),
    createdAt: datetime("created_at", { fsp: 6 }).default(sql`(UTC_TIMESTAMP(6))`).notNull(),
    updatedAt: datetime("updated_at", { fsp: 6 }).default(sql`(UTC_TIMESTAMP(6))`).notNull(),
  },
  (table) => ({
    tenantEffectiveIdx: index("billing_split_rules_tenant_effective_idx").on(
      table.tenantId,
      table.effectiveStart,
      table.effectiveEnd
    ),
  })
);

export const billingSplitLedger = mysqlTable(
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
    timeBucket: datetime("time_bucket", { fsp: 6 }).notNull(),
    createdAt: datetime("created_at", { fsp: 6 }).default(sql`(UTC_TIMESTAMP(6))`).notNull(),
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

export const billingSettlementWebhookConfig = mysqlTable("billing_settlement_webhook_config", {
  tenantId: varchar("tenant_id", { length: 26 }).primaryKey(),
  webhookUrl: text("webhook_url"),
  enabled: boolean("enabled").default(false).notNull(),
  updatedAt: datetime("updated_at", { fsp: 6 }).default(sql`(UTC_TIMESTAMP(6))`).notNull(),
});

export const billingSettlementWebhookEvents = mysqlTable(
  "billing_settlement_webhook_events",
  {
    id: varchar("id", { length: 26 }).primaryKey(),
    tenantId: varchar("tenant_id", { length: 26 }).notNull(),
    payload: json("payload").notNull(),
    status: varchar("status", { length: 32 }).notNull(),
    responseStatus: bigint("response_status", { mode: "number" }),
    createdAt: datetime("created_at", { fsp: 6 }).default(sql`(UTC_TIMESTAMP(6))`).notNull(),
  },
  (table) => ({
    tenantCreatedIdx: index("billing_settlement_webhook_events_tenant_idx").on(table.tenantId, table.createdAt),
  })
);
