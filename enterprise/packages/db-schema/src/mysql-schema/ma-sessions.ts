/** 托管会话面（MySQL）。只由 agent-runtime 写入；iam-core 只提供只读查询。 */
import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  datetime,
  index,
  int,
  json,
  mysqlTable,
  text,
  uniqueIndex,
  varchar,
} from "drizzle-orm/mysql-core";

import { enterpriseAgents } from "./agents";
import { auditColumns, ulid } from "./_shared";

const now = sql`(UTC_TIMESTAMP(6))`;

export const maSessions = mysqlTable(
  "ma_sessions",
  {
    id: ulid("id").primaryKey(),
    tenantId: ulid("tenant_id").notNull(),
    agentId: ulid("agent_id").notNull().references(() => enterpriseAgents.id, { onDelete: "restrict" }),
    agentVersion: int("agent_version").notNull(),
    environmentId: varchar("environment_id", { length: 26 }),
    createdByUserId: varchar("created_by_user_id", { length: 26 }),
    source: varchar("source", { length: 16 }).notNull(),
    status: varchar("status", { length: 16 }).notNull().default("idle"),
    stopReason: json("stop_reason").$type<Record<string, unknown> | null>(),
    title: varchar("title", { length: 255 }),
    vaultIds: json("vault_ids").notNull().default([]).$type<string[]>(),
    resources: json("resources").notNull().default([]).$type<Record<string, unknown>[]>(),
    usageTotals: json("usage_totals").notNull().default({}).$type<Record<string, number>>(),
    lastSeq: bigint("last_seq", { mode: "number" }).notNull().default(0),
    metadata: json("metadata").notNull().default({}).$type<Record<string, unknown>>(),
    archivedAt: datetime("archived_at", { fsp: 6 }),
    ...auditColumns,
  },
  (table) => ({
    tenantIdIdx: index("ma_sessions_tenant_id_idx").on(table.tenantId, table.id),
    tenantAgentIdx: index("ma_sessions_tenant_agent_idx").on(table.tenantId, table.agentId, table.createdAt),
    tenantStatusIdx: index("ma_sessions_tenant_status_idx").on(table.tenantId, table.status, table.updatedAt),
    tenantUserIdx: index("ma_sessions_tenant_user_idx").on(table.tenantId, table.createdByUserId, table.createdAt),
  }),
);

export const maSessionEvents = mysqlTable(
  "ma_session_events",
  {
    id: ulid("id").primaryKey(),
    tenantId: ulid("tenant_id").notNull(),
    sessionId: ulid("session_id").notNull().references(() => maSessions.id, { onDelete: "cascade" }),
    seq: bigint("seq", { mode: "number" }).notNull(),
    threadId: varchar("thread_id", { length: 26 }),
    type: varchar("type", { length: 64 }).notNull(),
    payload: json("payload").notNull().$type<Record<string, unknown>>(),
    createdAt: datetime("created_at", { fsp: 6 }).default(now).notNull(),
    processedAt: datetime("processed_at", { fsp: 6 }),
  },
  (table) => ({
    sessionSeqUq: uniqueIndex("ma_session_events_session_seq_uq").on(table.sessionId, table.seq),
    sessionTypeIdx: index("ma_session_events_session_type_idx").on(table.sessionId, table.type, table.seq),
    tenantCreatedIdx: index("ma_session_events_tenant_created_idx").on(table.tenantId, table.createdAt),
  }),
);

export const maWorkItems = mysqlTable(
  "ma_work_items",
  {
    id: ulid("id").primaryKey(),
    tenantId: ulid("tenant_id").notNull(),
    sessionId: ulid("session_id").notNull().references(() => maSessions.id, { onDelete: "cascade" }),
    environmentId: varchar("environment_id", { length: 26 }).notNull(),
    status: varchar("status", { length: 16 }).notNull().default("queued"),
    claimedByUserId: varchar("claimed_by_user_id", { length: 26 }),
    claimedByDevice: varchar("claimed_by_device", { length: 64 }),
    claimedAt: datetime("claimed_at", { fsp: 6 }),
    leaseExpiresAt: datetime("lease_expires_at", { fsp: 6 }),
    lastHeartbeatAt: datetime("last_heartbeat_at", { fsp: 6 }),
    attempts: int("attempts").notNull().default(0),
    completedAt: datetime("completed_at", { fsp: 6 }),
    error: text("error"),
    /** Worker inbox 起点：本工作项投递 seq 大于该值的用户事件。 */
    inboxAfterSeq: bigint("inbox_after_seq", { mode: "number" }).notNull().default(0),
    /** 工作项结束时已处理到的 seq；未结束为 null。 */
    consumedThroughSeq: bigint("consumed_through_seq", { mode: "number" }),
    ...auditColumns,
  },
  (table) => ({
    queueIdx: index("ma_work_items_queue_idx").on(table.tenantId, table.environmentId, table.status, table.createdAt),
    sessionIdx: index("ma_work_items_session_idx").on(table.sessionId, table.status),
  }),
);

export const maSessionUsage = mysqlTable(
  "ma_session_usage",
  {
    id: ulid("id").primaryKey(),
    tenantId: ulid("tenant_id").notNull(),
    sessionId: ulid("session_id").notNull().references(() => maSessions.id, { onDelete: "cascade" }),
    agentId: ulid("agent_id").notNull(),
    agentVersion: int("agent_version").notNull(),
    userId: varchar("user_id", { length: 26 }),
    model: varchar("model", { length: 160 }).notNull(),
    inputTokens: bigint("input_tokens", { mode: "number" }).notNull().default(0),
    outputTokens: bigint("output_tokens", { mode: "number" }).notNull().default(0),
    cacheReadInputTokens: bigint("cache_read_input_tokens", { mode: "number" }).notNull().default(0),
    toolCalls: int("tool_calls").notNull().default(0),
    runtimeMs: bigint("runtime_ms", { mode: "number" }).notNull().default(0),
    isError: boolean("is_error").notNull().default(false),
    eventSeq: bigint("event_seq", { mode: "number" }),
    createdAt: datetime("created_at", { fsp: 6 }).default(now).notNull(),
  },
  (table) => ({
    sessionEventUq: uniqueIndex("ma_session_usage_session_event_uq").on(table.sessionId, table.eventSeq),
    tenantAgentIdx: index("ma_session_usage_tenant_agent_idx").on(table.tenantId, table.agentId, table.createdAt),
    tenantUserIdx: index("ma_session_usage_tenant_user_idx").on(table.tenantId, table.userId, table.createdAt),
    tenantAgentUserIdx: index("ma_session_usage_quota_idx").on(table.tenantId, table.agentId, table.userId, table.createdAt),
  }),
);

export type MaSessionRow = typeof maSessions.$inferSelect;
export type MaSessionEventRow = typeof maSessionEvents.$inferSelect;
export type MaWorkItemRow = typeof maWorkItems.$inferSelect;
export type MaSessionUsageRow = typeof maSessionUsage.$inferSelect;
