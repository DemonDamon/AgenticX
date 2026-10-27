/**
 * 托管智能体评测（MySQL）。
 * query / expected_answer / answer 使用 mediumtext。
 * 写入方切分与 PostgreSQL 相同。
 */
import { sql } from "drizzle-orm";
import {
  datetime,
  index,
  int,
  json,
  mediumtext,
  mysqlTable,
  text,
  uniqueIndex,
  varchar,
} from "drizzle-orm/mysql-core";

import { auditColumns, ulid } from "./_shared";
import { tenants } from "./tenants";

export const maEvalDatasets = mysqlTable(
  "ma_eval_datasets",
  {
    id: ulid("id").primaryKey(),
    tenantId: ulid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 128 }).notNull(),
    description: varchar("description", { length: 1024 }),
    itemCount: int("item_count").notNull().default(0),
    createdBy: varchar("created_by", { length: 26 }),
    ...auditColumns,
  },
  (table) => ({
    tenantNameUq: uniqueIndex("ma_eval_datasets_tenant_name_uq").on(table.tenantId, table.name),
  }),
);

export const maEvalDatasetItems = mysqlTable(
  "ma_eval_dataset_items",
  {
    id: ulid("id").primaryKey(),
    tenantId: ulid("tenant_id").notNull(),
    datasetId: ulid("dataset_id").notNull().references(() => maEvalDatasets.id, { onDelete: "cascade" }),
    position: int("position").notNull(),
    query: mediumtext("query").notNull(),
    expectedAnswer: mediumtext("expected_answer"),
    expectedToolTrace: json("expected_tool_trace").$type<string[] | null>(),
    tags: json("tags").notNull().default([]).$type<string[]>(),
    sourceSessionId: varchar("source_session_id", { length: 26 }),
    ...auditColumns,
  },
  (table) => ({
    datasetPositionUq: uniqueIndex("ma_eval_dataset_items_dataset_position_uq").on(table.datasetId, table.position),
  }),
);

export const maEvalRubrics = mysqlTable(
  "ma_eval_rubrics",
  {
    id: ulid("id").primaryKey(),
    tenantId: ulid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 128 }).notNull(),
    description: varchar("description", { length: 1024 }),
    version: int("version").notNull().default(1),
    content: json("content").notNull().$type<Record<string, unknown>>(),
    contentHash: varchar("content_hash", { length: 80 }).notNull(),
    createdBy: varchar("created_by", { length: 26 }),
    ...auditColumns,
  },
  (table) => ({
    tenantNameUq: uniqueIndex("ma_eval_rubrics_tenant_name_uq").on(table.tenantId, table.name),
  }),
);

export const maEvalRuns = mysqlTable(
  "ma_eval_runs",
  {
    id: ulid("id").primaryKey(),
    tenantId: ulid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    kind: varchar("kind", { length: 16 }).notNull(),
    status: varchar("status", { length: 16 }).notNull().default("queued"),
    agentId: varchar("agent_id", { length: 26 }).notNull(),
    agentVersion: int("agent_version").notNull(),
    environmentId: varchar("environment_id", { length: 26 }),
    datasetId: varchar("dataset_id", { length: 26 }),
    datasetName: varchar("dataset_name", { length: 128 }).notNull(),
    datasetHash: varchar("dataset_hash", { length: 80 }).notNull(),
    rubricId: varchar("rubric_id", { length: 26 }),
    rubricName: varchar("rubric_name", { length: 128 }).notNull(),
    rubricVersion: int("rubric_version").notNull(),
    rubricHash: varchar("rubric_hash", { length: 80 }).notNull(),
    baseRunId: varchar("base_run_id", { length: 26 }),
    config: json("config").notNull().$type<Record<string, unknown>>(),
    progress: json("progress").notNull().default({}).$type<Record<string, number>>(),
    summary: json("summary").notNull().default({}).$type<Record<string, unknown>>(),
    error: text("error"),
    createdBy: varchar("created_by", { length: 26 }),
    claimedBy: varchar("claimed_by", { length: 64 }),
    heartbeatAt: datetime("heartbeat_at", { fsp: 6 }),
    startedAt: datetime("started_at", { fsp: 6 }),
    finishedAt: datetime("finished_at", { fsp: 6 }),
    ...auditColumns,
  },
  (table) => ({
    tenantCreatedIdx: index("ma_eval_runs_tenant_created_idx").on(table.tenantId, table.createdAt),
    statusCreatedIdx: index("ma_eval_runs_status_created_idx").on(table.status, table.createdAt),
    tenantAgentIdx: index("ma_eval_runs_tenant_agent_idx").on(table.tenantId, table.agentId, table.createdAt),
  }),
);

export const maEvalResults = mysqlTable(
  "ma_eval_results",
  {
    id: ulid("id").primaryKey(),
    tenantId: ulid("tenant_id").notNull(),
    runId: ulid("run_id").notNull().references(() => maEvalRuns.id, { onDelete: "cascade" }),
    itemId: varchar("item_id", { length: 26 }).notNull(),
    position: int("position").notNull(),
    status: varchar("status", { length: 16 }).notNull(),
    scoreMilli: int("score_milli"),
    sessionId: varchar("session_id", { length: 26 }),
    answer: mediumtext("answer"),
    toolNames: json("tool_names").notNull().default([]).$type<string[]>(),
    stopReason: varchar("stop_reason", { length: 32 }),
    ruleResults: json("rule_results").notNull().default([]).$type<Record<string, unknown>[]>(),
    judge: json("judge").$type<Record<string, unknown> | null>(),
    usage: json("usage").notNull().default({}).$type<Record<string, number>>(),
    durationMs: int("duration_ms").notNull().default(0),
    error: text("error"),
    createdAt: datetime("created_at", { fsp: 6 }).default(sql`(UTC_TIMESTAMP(6))`).notNull(),
  },
  (table) => ({
    runItemUq: uniqueIndex("ma_eval_results_run_item_uq").on(table.runId, table.itemId),
    runPositionIdx: index("ma_eval_results_run_position_idx").on(table.runId, table.position),
  }),
);

export const maEvalCandidates = mysqlTable(
  "ma_eval_candidates",
  {
    id: ulid("id").primaryKey(),
    tenantId: ulid("tenant_id").notNull(),
    runId: ulid("run_id").notNull().references(() => maEvalRuns.id, { onDelete: "cascade" }),
    baseRunId: varchar("base_run_id", { length: 26 }).notNull(),
    agentId: varchar("agent_id", { length: 26 }).notNull(),
    baseVersion: int("base_version").notNull(),
    manifest: json("manifest").notNull().$type<Record<string, unknown>>(),
    manifestHash: varchar("manifest_hash", { length: 80 }).notNull(),
    diff: json("diff").notNull().default({}).$type<Record<string, unknown>>(),
    rationale: text("rationale"),
    status: varchar("status", { length: 16 }).notNull().default("proposed"),
    appliedVersion: int("applied_version"),
    decidedBy: varchar("decided_by", { length: 26 }),
    decidedAt: datetime("decided_at", { fsp: 6 }),
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
