/**
 * 托管智能体评测。
 * 写入方：datasets / items / rubrics = admin-console；
 * runs / results / candidates = agent-runtime（admin-console 只读）。
 */
import { index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, varchar } from "drizzle-orm/pg-core";

import { auditColumns, ulid } from "./_shared";
import { tenants } from "./tenants";

export const maEvalDatasets = pgTable(
  "ma_eval_datasets",
  {
    id: ulid("id").primaryKey(),
    tenantId: ulid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 128 }).notNull(),
    description: varchar("description", { length: 1024 }),
    itemCount: integer("item_count").notNull().default(0),
    createdBy: varchar("created_by", { length: 26 }),
    ...auditColumns,
  },
  (table) => ({
    tenantNameUq: uniqueIndex("ma_eval_datasets_tenant_name_uq").on(table.tenantId, table.name),
  }),
);

export const maEvalDatasetItems = pgTable(
  "ma_eval_dataset_items",
  {
    id: ulid("id").primaryKey(),
    tenantId: ulid("tenant_id").notNull(),
    datasetId: ulid("dataset_id").notNull().references(() => maEvalDatasets.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    query: text("query").notNull(),
    expectedAnswer: text("expected_answer"),
    expectedToolTrace: jsonb("expected_tool_trace").$type<string[] | null>(),
    tags: jsonb("tags").notNull().default([]).$type<string[]>(),
    sourceSessionId: varchar("source_session_id", { length: 26 }),
    ...auditColumns,
  },
  (table) => ({
    datasetPositionUq: uniqueIndex("ma_eval_dataset_items_dataset_position_uq").on(table.datasetId, table.position),
  }),
);

export const maEvalRubrics = pgTable(
  "ma_eval_rubrics",
  {
    id: ulid("id").primaryKey(),
    tenantId: ulid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 128 }).notNull(),
    description: varchar("description", { length: 1024 }),
    version: integer("version").notNull().default(1),
    content: jsonb("content").notNull().$type<Record<string, unknown>>(),
    contentHash: varchar("content_hash", { length: 80 }).notNull(),
    createdBy: varchar("created_by", { length: 26 }),
    ...auditColumns,
  },
  (table) => ({
    tenantNameUq: uniqueIndex("ma_eval_rubrics_tenant_name_uq").on(table.tenantId, table.name),
  }),
);

export const maEvalRuns = pgTable(
  "ma_eval_runs",
  {
    id: ulid("id").primaryKey(),
    tenantId: ulid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    kind: varchar("kind", { length: 16 }).notNull(),
    status: varchar("status", { length: 16 }).notNull().default("queued"),
    agentId: varchar("agent_id", { length: 26 }).notNull(),
    agentVersion: integer("agent_version").notNull(),
    environmentId: varchar("environment_id", { length: 26 }),
    datasetId: varchar("dataset_id", { length: 26 }),
    datasetName: varchar("dataset_name", { length: 128 }).notNull(),
    datasetHash: varchar("dataset_hash", { length: 80 }).notNull(),
    rubricId: varchar("rubric_id", { length: 26 }),
    rubricName: varchar("rubric_name", { length: 128 }).notNull(),
    rubricVersion: integer("rubric_version").notNull(),
    rubricHash: varchar("rubric_hash", { length: 80 }).notNull(),
    baseRunId: varchar("base_run_id", { length: 26 }),
    config: jsonb("config").notNull().$type<Record<string, unknown>>(),
    progress: jsonb("progress").notNull().default({}).$type<Record<string, number>>(),
    summary: jsonb("summary").notNull().default({}).$type<Record<string, unknown>>(),
    error: text("error"),
    createdBy: varchar("created_by", { length: 26 }),
    claimedBy: varchar("claimed_by", { length: 64 }),
    heartbeatAt: timestamp("heartbeat_at", { withTimezone: true }),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    ...auditColumns,
  },
  (table) => ({
    tenantCreatedIdx: index("ma_eval_runs_tenant_created_idx").on(table.tenantId, table.createdAt),
    statusCreatedIdx: index("ma_eval_runs_status_created_idx").on(table.status, table.createdAt),
    tenantAgentIdx: index("ma_eval_runs_tenant_agent_idx").on(table.tenantId, table.agentId, table.createdAt),
  }),
);

export const maEvalResults = pgTable(
  "ma_eval_results",
  {
    id: ulid("id").primaryKey(),
    tenantId: ulid("tenant_id").notNull(),
    runId: ulid("run_id").notNull().references(() => maEvalRuns.id, { onDelete: "cascade" }),
    itemId: varchar("item_id", { length: 26 }).notNull(),
    position: integer("position").notNull(),
    status: varchar("status", { length: 16 }).notNull(),
    scoreMilli: integer("score_milli"),
    sessionId: varchar("session_id", { length: 26 }),
    answer: text("answer"),
    toolNames: jsonb("tool_names").notNull().default([]).$type<string[]>(),
    stopReason: varchar("stop_reason", { length: 32 }),
    ruleResults: jsonb("rule_results").notNull().default([]).$type<Record<string, unknown>[]>(),
    judge: jsonb("judge").$type<Record<string, unknown> | null>(),
    usage: jsonb("usage").notNull().default({}).$type<Record<string, number>>(),
    durationMs: integer("duration_ms").notNull().default(0),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    runItemUq: uniqueIndex("ma_eval_results_run_item_uq").on(table.runId, table.itemId),
    runPositionIdx: index("ma_eval_results_run_position_idx").on(table.runId, table.position),
  }),
);

export const maEvalCandidates = pgTable(
  "ma_eval_candidates",
  {
    id: ulid("id").primaryKey(),
    tenantId: ulid("tenant_id").notNull(),
    runId: ulid("run_id").notNull().references(() => maEvalRuns.id, { onDelete: "cascade" }),
    baseRunId: varchar("base_run_id", { length: 26 }).notNull(),
    agentId: varchar("agent_id", { length: 26 }).notNull(),
    baseVersion: integer("base_version").notNull(),
    manifest: jsonb("manifest").notNull().$type<Record<string, unknown>>(),
    manifestHash: varchar("manifest_hash", { length: 80 }).notNull(),
    diff: jsonb("diff").notNull().default({}).$type<Record<string, unknown>>(),
    rationale: text("rationale"),
    status: varchar("status", { length: 16 }).notNull().default("proposed"),
    appliedVersion: integer("applied_version"),
    decidedBy: varchar("decided_by", { length: 26 }),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    ...auditColumns,
  },
  (table) => ({
    tenantAgentIdx: index("ma_eval_candidates_tenant_agent_idx").on(table.tenantId, table.agentId, table.createdAt),
  }),
);

export type MaEvalDatasetRow = typeof maEvalDatasets.$inferSelect;
export type MaEvalDatasetItemRow = typeof maEvalDatasetItems.$inferSelect;
export type MaEvalRubricRow = typeof maEvalRubrics.$inferSelect;
export type MaEvalRunRow = typeof maEvalRuns.$inferSelect;
export type MaEvalResultRow = typeof maEvalResults.$inferSelect;
export type MaEvalCandidateRow = typeof maEvalCandidates.$inferSelect;
