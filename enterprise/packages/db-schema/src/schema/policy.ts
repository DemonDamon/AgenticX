import { boolean, index, integer, jsonb, pgTable, timestamp, uniqueIndex, varchar } from "drizzle-orm/pg-core";
import { auditColumns, ulid } from "./_shared";
import { tenants } from "./tenants";

export type PolicyAppliesTo = {
  version?: number;
  departmentIds?: string[];
  departmentRecursive?: boolean;
  roleCodes?: string[];
  userIds?: string[];
  userExcludeIds?: string[];
  clientTypes?: string[];
  stages?: string[];
};

export const policyRulePacks = pgTable(
  "policy_rule_packs",
  {
    id: ulid("id").primaryKey(),
    tenantId: ulid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    code: varchar("code", { length: 64 }).notNull(),
    name: varchar("name", { length: 128 }).notNull(),
    description: varchar("description", { length: 512 }),
    source: varchar("source", { length: 16 }).notNull().default("custom"),
    enabled: boolean("enabled").notNull().default(true),
    appliesTo: jsonb("applies_to").$type<PolicyAppliesTo>().notNull().default({}),
    ...auditColumns,
  },
  (table) => ({
    tenantCodeUq: uniqueIndex("policy_rule_packs_tenant_code_uq").on(table.tenantId, table.code),
    tenantUpdatedIdx: index("policy_rule_packs_tenant_updated_idx").on(table.tenantId, table.updatedAt),
  })
);

export const policyRules = pgTable(
  "policy_rules",
  {
    id: ulid("id").primaryKey(),
    tenantId: ulid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    packId: ulid("pack_id")
      .notNull()
      .references(() => policyRulePacks.id, { onDelete: "cascade" }),
    code: varchar("code", { length: 64 }).notNull(),
    kind: varchar("kind", { length: 16 }).notNull(),
    action: varchar("action", { length: 16 }).notNull(),
    severity: varchar("severity", { length: 16 }).notNull(),
    message: varchar("message", { length: 512 }),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    appliesTo: jsonb("applies_to").$type<PolicyAppliesTo>(),
    status: varchar("status", { length: 16 }).notNull().default("draft"),
    updatedBy: ulid("updated_by"),
    ...auditColumns,
  },
  (table) => ({
    tenantPackCodeUq: uniqueIndex("policy_rules_tenant_pack_code_uq").on(table.tenantId, table.packId, table.code),
    tenantStatusIdx: index("policy_rules_tenant_status_idx").on(table.tenantId, table.status),
    tenantPackIdx: index("policy_rules_tenant_pack_idx").on(table.tenantId, table.packId),
    tenantUpdatedIdx: index("policy_rules_tenant_updated_idx").on(table.tenantId, table.updatedAt),
  })
);

export const policyRuleVersions = pgTable(
  "policy_rule_versions",
  {
    id: ulid("id").primaryKey(),
    tenantId: ulid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    ruleId: ulid("rule_id")
      .notNull()
      .references(() => policyRules.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    snapshot: jsonb("snapshot").$type<Record<string, unknown>>().notNull(),
    author: ulid("author"),
    ...auditColumns,
  },
  (table) => ({
    tenantRuleVersionUq: uniqueIndex("policy_rule_versions_tenant_rule_version_uq").on(
      table.tenantId,
      table.ruleId,
      table.version
    ),
    tenantRuleIdx: index("policy_rule_versions_tenant_rule_idx").on(table.tenantId, table.ruleId),
  })
);

export const policyPublishEvents = pgTable(
  "policy_publish_events",
  {
    id: ulid("id").primaryKey(),
    tenantId: ulid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    snapshot: jsonb("snapshot").$type<Record<string, unknown>>().notNull(),
    summary: jsonb("summary").$type<Record<string, unknown>>(),
    publisher: ulid("publisher"),
    publishedAt: timestamp("published_at", { withTimezone: true }).notNull().defaultNow(),
    status: varchar("status", { length: 16 }).notNull().default("published"),
    ...auditColumns,
  },
  (table) => ({
    tenantVersionUq: uniqueIndex("policy_publish_events_tenant_version_uq").on(table.tenantId, table.version),
    tenantPublishedIdx: index("policy_publish_events_tenant_published_idx").on(table.tenantId, table.publishedAt),
  })
);

export type PolicyRulePackRow = typeof policyRulePacks.$inferSelect;
export type NewPolicyRulePackRow = typeof policyRulePacks.$inferInsert;
export type PolicyRuleRow = typeof policyRules.$inferSelect;
export type NewPolicyRuleRow = typeof policyRules.$inferInsert;
export type PolicyRuleVersionRow = typeof policyRuleVersions.$inferSelect;
export type NewPolicyRuleVersionRow = typeof policyRuleVersions.$inferInsert;
export type PolicyPublishEventRow = typeof policyPublishEvents.$inferSelect;
export type NewPolicyPublishEventRow = typeof policyPublishEvents.$inferInsert;
