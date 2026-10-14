/**
 * 桌面执行心跳与任务队列。
 *
 * `worker_keys` 在 `enterprise_agents` 上，格式同 `assignment_keys`。
 * 员工分配键与之有交集才是合格 Worker。空数组表示没有人能承接。
 */
import { index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, varchar } from "drizzle-orm/pg-core";

import { enterpriseAgents } from "./agents";
import { enterpriseCollabRooms } from "./collab-rooms";
import { auditColumns, ulid } from "./_shared";
import { users } from "./users";

export const enterpriseAgentWorkers = pgTable(
  "enterprise_agent_workers",
  {
    id: ulid("id").primaryKey(),
    tenantId: ulid("tenant_id").notNull(),
    agentId: ulid("agent_id")
      .notNull()
      .references(() => enterpriseAgents.id, { onDelete: "cascade" }),
    userId: ulid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    deviceId: varchar("device_id", { length: 64 }).notNull(),
    deviceName: varchar("device_name", { length: 128 }).notNull(),
    lastHeartbeatAt: timestamp("last_heartbeat_at", { withTimezone: true }).notNull(),
    ...auditColumns,
  },
  (table) => ({
    agentUserDeviceUq: uniqueIndex("enterprise_agent_workers_agent_user_device_uq").on(
      table.agentId,
      table.userId,
      table.deviceId,
    ),
  }),
);

export const enterpriseAgentTasks = pgTable(
  "enterprise_agent_tasks",
  {
    id: ulid("id").primaryKey(),
    tenantId: ulid("tenant_id").notNull(),
    agentId: ulid("agent_id")
      .notNull()
      .references(() => enterpriseAgents.id, { onDelete: "cascade" }),
    roomId: ulid("room_id")
      .notNull()
      .references(() => enterpriseCollabRooms.id, { onDelete: "cascade" }),
    triggerMessageId: varchar("trigger_message_id", { length: 26 }).notNull(),
    requestedBy: ulid("requested_by").notNull(),
    status: varchar("status", { length: 16 }).notNull().default("queued"),
    input: jsonb("input").notNull().$type<Record<string, unknown>>(),
    attempts: integer("attempts").notNull().default(0),
    claimedByUserId: ulid("claimed_by_user_id"),
    claimedByDevice: varchar("claimed_by_device", { length: 64 }),
    claimedAt: timestamp("claimed_at", { withTimezone: true }),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    resultMessageId: varchar("result_message_id", { length: 26 }),
    error: text("error"),
    ...auditColumns,
  },
  (table) => ({
    queueIdx: index("enterprise_agent_tasks_queue_idx").on(
      table.tenantId,
      table.agentId,
      table.status,
      table.createdAt,
    ),
  }),
);

export type EnterpriseAgentWorkerRow = typeof enterpriseAgentWorkers.$inferSelect;
export type NewEnterpriseAgentWorkerRow = typeof enterpriseAgentWorkers.$inferInsert;
export type EnterpriseAgentTaskRow = typeof enterpriseAgentTasks.$inferSelect;
export type NewEnterpriseAgentTaskRow = typeof enterpriseAgentTasks.$inferInsert;
