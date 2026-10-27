/**
 * 托管智能体记忆整理任务。
 * 唯一写入方：agent-runtime。admin-console 只读。
 */
import { boolean, index, jsonb, pgTable, text, timestamp, varchar } from "drizzle-orm/pg-core";

import { auditColumns, ulid } from "./_shared";
import { tenants } from "./tenants";

export const maMemoryDreams = pgTable(
  "ma_memory_dreams",
  {
    id: ulid("id").primaryKey(),
    tenantId: ulid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    status: varchar("status", { length: 16 }).notNull().default("pending"),
    inputMemoryStoreId: varchar("input_memory_store_id", { length: 26 }).notNull(),
    outputMemoryStoreId: varchar("output_memory_store_id", { length: 26 }).notNull(),
    sessionIds: jsonb("session_ids").notNull().$type<string[]>(),
    instructions: text("instructions").notNull(),
    model: varchar("model", { length: 160 }).notNull(),
    report: jsonb("report").notNull().default({}).$type<Record<string, unknown>>(),
    error: jsonb("error").$type<Record<string, unknown> | null>(),
    cancelRequested: boolean("cancel_requested").notNull().default(false),
    createdBy: varchar("created_by", { length: 26 }),
    claimedBy: varchar("claimed_by", { length: 64 }),
    heartbeatAt: timestamp("heartbeat_at", { withTimezone: true }),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    ...auditColumns,
  },
  (table) => ({
    tenantCreatedIdx: index("ma_memory_dreams_tenant_created_idx").on(table.tenantId, table.createdAt),
    statusCreatedIdx: index("ma_memory_dreams_status_created_idx").on(table.status, table.createdAt),
    tenantInputIdx: index("ma_memory_dreams_tenant_input_idx").on(
      table.tenantId,
      table.inputMemoryStoreId,
      table.createdAt,
    ),
  }),
);

export type MaMemoryDreamRow = typeof maMemoryDreams.$inferSelect;
