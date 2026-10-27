/**
 * 托管定时任务（MySQL）。ma_schedules 只由 admin-console 写入。
 * ma_schedule_runs 只由 agent-runtime 写入；管理台只读展示，因此不加外键。
 */
import { boolean, datetime, index, int, json, mysqlTable, text, uniqueIndex, varchar } from "drizzle-orm/mysql-core";

import { enterpriseAgents } from "./agents";
import { auditColumns, ulid } from "./_shared";
import { tenants } from "./tenants";

export const maSchedules = mysqlTable(
  "ma_schedules",
  {
    id: ulid("id").primaryKey(),
    tenantId: ulid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 120 }).notNull(),
    description: text("description"),
    agentId: ulid("agent_id").notNull().references(() => enterpriseAgents.id, { onDelete: "cascade" }),
    versionPolicy: varchar("version_policy", { length: 16 }).notNull().default("follow_routing"),
    pinnedVersion: int("pinned_version"),
    environmentId: varchar("environment_id", { length: 26 }),
    cron: varchar("cron", { length: 120 }).notNull(),
    timezone: varchar("timezone", { length: 64 }).notNull().default("Asia/Shanghai"),
    inputTemplate: text("input_template").notNull(),
    vaultIds: json("vault_ids").notNull().default([]).$type<string[]>(),
    resources: json("resources").notNull().default([]).$type<Record<string, unknown>[]>(),
    runAsUserId: varchar("run_as_user_id", { length: 26 }).notNull(),
    enabled: boolean("enabled").notNull().default(true),
    revision: int("revision").notNull().default(1),
    misfireGraceSeconds: int("misfire_grace_seconds").notNull().default(300),
    manualRunRequestedAt: datetime("manual_run_requested_at", { fsp: 6 }),
    createdBy: varchar("created_by", { length: 26 }),
    ...auditColumns,
  },
  (table) => ({
    tenantNameUq: uniqueIndex("ma_schedules_tenant_name_uq").on(table.tenantId, table.name),
    tenantAgentIdx: index("ma_schedules_tenant_agent_idx").on(table.tenantId, table.agentId),
  }),
);

export const maScheduleRuns = mysqlTable(
  "ma_schedule_runs",
  {
    id: ulid("id").primaryKey(),
    tenantId: ulid("tenant_id").notNull(),
    scheduleId: ulid("schedule_id").notNull(),
    scheduleRevision: int("schedule_revision").notNull(),
    trigger: varchar("trigger", { length: 16 }).notNull(),
    scheduledFor: datetime("scheduled_for", { fsp: 6 }).notNull(),
    status: varchar("status", { length: 16 }).notNull().default("scheduled"),
    skipReason: varchar("skip_reason", { length: 32 }),
    sessionId: varchar("session_id", { length: 26 }),
    agentVersion: int("agent_version"),
    error: varchar("error", { length: 500 }),
    startedAt: datetime("started_at", { fsp: 6 }),
    finishedAt: datetime("finished_at", { fsp: 6 }),
    ...auditColumns,
  },
  (table) => ({
    slotUq: uniqueIndex("ma_schedule_runs_slot_uq").on(table.scheduleId, table.trigger, table.scheduledFor),
    dueIdx: index("ma_schedule_runs_due_idx").on(table.status, table.scheduledFor),
    scheduleIdx: index("ma_schedule_runs_schedule_idx").on(table.tenantId, table.scheduleId, table.scheduledFor),
    sessionIdx: index("ma_schedule_runs_session_idx").on(table.sessionId),
  }),
);

export type MaScheduleRow = typeof maSchedules.$inferSelect;
export type MaScheduleRunRow = typeof maScheduleRuns.$inferSelect;
