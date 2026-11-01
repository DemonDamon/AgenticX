/**
 * ECP E3 · 审核工作流（申请单 + 步骤 + 租户/平台预设绑定）
 */
import { index, integer, jsonb, pgTable, text, uniqueIndex, varchar } from "drizzle-orm/pg-core";

import { auditColumns, ulid } from "./_shared";
import { tenants } from "./tenants";

/** 内置审核预设（种子数据，非客户定制）。 */
export const approvalWorkflowPresets = pgTable(
  "approval_workflow_presets",
  {
    id: ulid("id").primaryKey(),
    slug: varchar("slug", { length: 64 }).notNull(),
    displayName: varchar("display_name", { length: 128 }).notNull(),
    stepDefinitions: jsonb("step_definitions")
      .notNull()
      .default([])
      .$type<Array<{ kind: string; actorScope: string | null }>>(),
    ...auditColumns,
  },
  (table) => ({
    slugUq: uniqueIndex("approval_workflow_presets_slug_uq").on(table.slug),
  }),
);

/** 审核申请单。 */
export const approvalRequests = pgTable(
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
    /** 例如 catalog publish 附带的 versionId */
    contextJson: jsonb("context_json").notNull().default({}).$type<Record<string, unknown>>(),
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

/** 申请单步骤（含自动 scan 与人工节点）。 */
export const approvalSteps = pgTable(
  "approval_steps",
  {
    id: ulid("id").primaryKey(),
    requestId: ulid("request_id")
      .notNull()
      .references(() => approvalRequests.id, { onDelete: "cascade" }),
    stepOrder: integer("step_order").notNull(),
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

/** 租户级：各动作绑定的审核预设（空 = 不启用审核，仅 E2 scan 门禁）。 */
export const ecpApprovalSettings = pgTable("ecp_approval_settings", {
  tenantId: ulid("tenant_id")
    .primaryKey()
    .references(() => tenants.id, { onDelete: "cascade" }),
  skillPublishPresetSlug: varchar("skill_publish_preset_slug", { length: 64 }),
  platformIntroducePresetSlug: varchar("platform_introduce_preset_slug", { length: 64 }),
  ...auditColumns,
});

/** 平台级：目录版本上架审核预设（单行 id=default）。 */
export const ecpPlatformApprovalSettings = pgTable("ecp_platform_approval_settings", {
  id: varchar("id", { length: 32 }).primaryKey(),
  catalogPublishPresetSlug: varchar("catalog_publish_preset_slug", { length: 64 }),
  ...auditColumns,
});

export type ApprovalRequestRow = typeof approvalRequests.$inferSelect;
export type ApprovalStepRow = typeof approvalSteps.$inferSelect;
