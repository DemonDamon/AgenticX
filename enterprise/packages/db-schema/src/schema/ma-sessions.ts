/** 托管会话面。只由 agent-runtime 写入；iam-core 只提供只读查询。 */
import { bigint, boolean, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, varchar } from "drizzle-orm/pg-core";

import { enterpriseAgents } from "./agents";
import { auditColumns, ulid } from "./_shared";

export const maSessions = pgTable(
  "ma_sessions",
  {
    id: ulid("id").primaryKey(),
    tenantId: ulid("tenant_id").notNull(),
    agentId: ulid("agent_id").notNull().references(() => enterpriseAgents.id, { onDelete: "restrict" }),
    agentVersion: integer("agent_version").notNull(),
    environmentId: varchar("environment_id", { length: 26 }),
    createdByUserId: varchar("created_by_user_id", { length: 26 }),
    source: varchar("source", { length: 16 }).notNull(),
    status: varchar("status", { length: 16 }).notNull().default("idle"),
    stopReason: jsonb("stop_reason").$type<Record<string, unknown> | null>(),
    title: varchar("title", { length: 255 }),
    vaultIds: jsonb("vault_ids").notNull().default([]).$type<string[]>(),
    resources: jsonb("resources").notNull().default([]).$type<Record<string, unknown>[]>(),
    usageTotals: jsonb("usage_totals").notNull().default({}).$type<Record<string, number>>(),
    lastSeq: bigint("last_seq", { mode: "number" }).notNull().default(0),
    metadata: jsonb("metadata").notNull().default({}).$type<Record<string, unknown>>(),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    ...auditColumns,
  },
  (table) => ({
    tenantIdIdx: index("ma_sessions_tenant_id_idx").on(table.tenantId, table.id),
    tenantAgentIdx: index("ma_sessions_tenant_agent_idx").on(table.tenantId, table.agentId, table.createdAt),
    tenantStatusIdx: index("ma_sessions_tenant_status_idx").on(table.tenantId, table.status, table.updatedAt),
    tenantUserIdx: index("ma_sessions_tenant_user_idx").on(table.tenantId, table.createdByUserId, table.createdAt),
  }),
);

export const maSessionEvents = pgTable(
  "ma_session_events",
  {
    id: ulid("id").primaryKey(),
    tenantId: ulid("tenant_id").notNull(),
    sessionId: ulid("session_id").notNull().references(() => maSessions.id, { onDelete: "cascade" }),
    seq: bigint("seq", { mode: "number" }).notNull(),
    threadId: varchar("thread_id", { length: 26 }),
    type: varchar("type", { length: 64 }).notNull(),
    payload: jsonb("payload").notNull().$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    processedAt: timestamp("processed_at", { withTimezone: true }),
  },
  (table) => ({
    sessionSeqUq: uniqueIndex("ma_session_events_session_seq_uq").on(table.sessionId, table.seq),
    sessionTypeIdx: index("ma_session_events_session_type_idx").on(table.sessionId, table.type, table.seq),
    tenantCreatedIdx: index("ma_session_events_tenant_created_idx").on(table.tenantId, table.createdAt),
  }),
);

export const maWorkItems = pgTable(
  "ma_work_items",
  {
    id: ulid("id").primaryKey(),
    tenantId: ulid("tenant_id").notNull(),
    sessionId: ulid("session_id").notNull().references(() => maSessions.id, { onDelete: "cascade" }),
    environmentId: varchar("environment_id", { length: 26 }).notNull(),
    status: varchar("status", { length: 16 }).notNull().default("queued"),
    claimedByUserId: varchar("claimed_by_user_id", { length: 26 }),
    claimedByDevice: varchar("claimed_by_device", { length: 64 }),
    claimedAt: timestamp("claimed_at", { withTimezone: true }),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
    lastHeartbeatAt: timestamp("last_heartbeat_at", { withTimezone: true }),
    attempts: integer("attempts").notNull().default(0),
    completedAt: timestamp("completed_at", { withTimezone: true }),
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

export const maSessionUsage = pgTable(
  "ma_session_usage",
  {
    id: ulid("id").primaryKey(),
    tenantId: ulid("tenant_id").notNull(),
    sessionId: ulid("session_id").notNull().references(() => maSessions.id, { onDelete: "cascade" }),
    agentId: ulid("agent_id").notNull(),
    agentVersion: integer("agent_version").notNull(),
    userId: varchar("user_id", { length: 26 }),
    model: varchar("model", { length: 160 }).notNull(),
    inputTokens: bigint("input_tokens", { mode: "number" }).notNull().default(0),
    outputTokens: bigint("output_tokens", { mode: "number" }).notNull().default(0),
    cacheReadInputTokens: bigint("cache_read_input_tokens", { mode: "number" }).notNull().default(0),
    toolCalls: integer("tool_calls").notNull().default(0),
    runtimeMs: bigint("runtime_ms", { mode: "number" }).notNull().default(0),
    isError: boolean("is_error").notNull().default(false),
    eventSeq: bigint("event_seq", { mode: "number" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
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
