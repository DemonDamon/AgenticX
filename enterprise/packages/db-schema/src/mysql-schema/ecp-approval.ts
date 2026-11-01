/**
 * ECP E3 · 审核工作流（MySQL）
 */
import { index, int, json, mysqlTable, text, uniqueIndex, varchar } from "drizzle-orm/mysql-core";

import { auditColumns, ulid } from "./_shared";
import { tenants } from "./tenants";

export const approvalWorkflowPresets = mysqlTable(
  "approval_workflow_presets",
  {
    id: ulid("id").primaryKey(),
    slug: varchar("slug", { length: 64 }).notNull(),
    displayName: varchar("display_name", { length: 128 }).notNull(),
    stepDefinitions: json("step_definitions")
      .notNull()
      .default([])
      .$type<Array<{ kind: string; actorScope: string | null }>>(),
    ...auditColumns,
  },
  (table) => ({
    slugUq: uniqueIndex("approval_workflow_presets_slug_uq").on(table.slug),
  }),
);

export const approvalRequests = mysqlTable(
  "approval_requests",
  {
    id: ulid("id").primaryKey(),
    tenantId: ulid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    presetSlug: varchar("preset_slug", { length: 64 }).notNull(),
    resourceType: varchar("resource_type", { length: 48 }).notNull(),
    resourceId: ulid("resource_id").notNull(),
    action: varchar("action", { length: 32 }).notNull(),
    status: varchar("status", { length: 16 }).notNull().default("pending"),
    requesterUserId: ulid("requester_user_id"),
    requesterEmail: varchar("requester_email", { length: 256 }),
    rejectionReason: text("rejection_reason"),
    contextJson: json("context_json").notNull().default({}).$type<Record<string, unknown>>(),
    consumedAt: varchar("consumed_at", { length: 32 }),
    completedAt: varchar("completed_at", { length: 32 }),
    ...auditColumns,
  },
  (table) => ({
    tenantStatusIdx: index("approval_requests_tenant_status_idx").on(table.tenantId, table.status),
    resourceIdx: index("approval_requests_resource_idx").on(
      table.resourceType,
      table.resourceId,
      table.action,
    ),
  }),
);

export const approvalSteps = mysqlTable(
  "approval_steps",
  {
    id: ulid("id").primaryKey(),
    requestId: ulid("request_id")
      .notNull()
      .references(() => approvalRequests.id, { onDelete: "cascade" }),
    stepOrder: int("step_order").notNull(),
    stepKind: varchar("step_kind", { length: 16 }).notNull(),
    actorScope: varchar("actor_scope", { length: 32 }),
    status: varchar("status", { length: 16 }).notNull().default("pending"),
    decisionNote: text("decision_note"),
    decidedByUserId: ulid("decided_by_user_id"),
    decidedByEmail: varchar("decided_by_email", { length: 256 }),
    decidedAt: varchar("decided_at", { length: 32 }),
    ...auditColumns,
  },
  (table) => ({
    requestOrderUq: uniqueIndex("approval_steps_request_order_uq").on(table.requestId, table.stepOrder),
    requestIdx: index("approval_steps_request_idx").on(table.requestId),
  }),
);

export const ecpApprovalSettings = mysqlTable("ecp_approval_settings", {
  tenantId: ulid("tenant_id")
    .primaryKey()
    .references(() => tenants.id, { onDelete: "cascade" }),
  skillPublishPresetSlug: varchar("skill_publish_preset_slug", { length: 64 }),
  platformIntroducePresetSlug: varchar("platform_introduce_preset_slug", { length: 64 }),
  ...auditColumns,
});

export const ecpPlatformApprovalSettings = mysqlTable("ecp_platform_approval_settings", {
  id: varchar("id", { length: 32 }).primaryKey(),
  catalogPublishPresetSlug: varchar("catalog_publish_preset_slug", { length: 64 }),
  ...auditColumns,
});
