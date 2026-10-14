/**
 * 桌面执行心跳与任务队列（MySQL）。
 *
 * `worker_keys` / 任务 `input` 在此方言下落为 json。
 */
import { datetime, index, int, json, mysqlTable, text, uniqueIndex, varchar } from "drizzle-orm/mysql-core";

import { enterpriseAgents } from "./agents";
import { enterpriseCollabRooms } from "./collab-rooms";
import { auditColumns, ulid } from "./_shared";
import { users } from "./users";

export const enterpriseAgentWorkers = mysqlTable(
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
    lastHeartbeatAt: datetime("last_heartbeat_at", { fsp: 6 }).notNull(),
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

export const enterpriseAgentTasks = mysqlTable(
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
    input: json("input").notNull().$type<Record<string, unknown>>(),
    attempts: int("attempts").notNull().default(0),
    claimedByUserId: ulid("claimed_by_user_id"),
    claimedByDevice: varchar("claimed_by_device", { length: 64 }),
    claimedAt: datetime("claimed_at", { fsp: 6 }),
    leaseExpiresAt: datetime("lease_expires_at", { fsp: 6 }),
    completedAt: datetime("completed_at", { fsp: 6 }),
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
