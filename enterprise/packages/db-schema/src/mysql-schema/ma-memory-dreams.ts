/**
 * 托管智能体记忆整理任务（MySQL）。
 * 唯一写入方：agent-runtime。admin-console 只读。
 */
import { sql } from "drizzle-orm";
import { boolean, datetime, index, json, mysqlTable, text, varchar } from "drizzle-orm/mysql-core";

import { auditColumns, ulid } from "./_shared";
import { tenants } from "./tenants";

export const maMemoryDreams = mysqlTable(
  "ma_memory_dreams",
  {
    id: ulid("id").primaryKey(),
    tenantId: ulid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    status: varchar("status", { length: 16 }).notNull().default("pending"),
    inputMemoryStoreId: varchar("input_memory_store_id", { length: 26 }).notNull(),
    outputMemoryStoreId: varchar("output_memory_store_id", { length: 26 }).notNull(),
    sessionIds: json("session_ids").notNull().$type<string[]>(),
    instructions: text("instructions").notNull(),
    model: varchar("model", { length: 160 }).notNull(),
    report: json("report").notNull().default(sql`(JSON_OBJECT())`).$type<Record<string, unknown>>(),
    error: json("error").$type<Record<string, unknown> | null>(),
    cancelRequested: boolean("cancel_requested").notNull().default(false),
    createdBy: varchar("created_by", { length: 26 }),
    claimedBy: varchar("claimed_by", { length: 64 }),
    heartbeatAt: datetime("heartbeat_at", { fsp: 6 }),
    startedAt: datetime("started_at", { fsp: 6 }),
    finishedAt: datetime("finished_at", { fsp: 6 }),
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
