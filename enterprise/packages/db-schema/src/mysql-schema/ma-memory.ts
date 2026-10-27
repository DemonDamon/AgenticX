/**
 * 托管智能体记忆库（MySQL）。唯一物理写入方：admin-console。
 * content 使用 mediumtext（text 上限 65535 字节，小于 100 KiB）。
 * ma_memory_versions 不可更新（脱敏除外）；memory_id 不加外键，删除记忆行后版本保留。
 */
import { sql } from "drizzle-orm";
import { boolean, datetime, index, int, json, mediumtext, mysqlTable, uniqueIndex, varchar } from "drizzle-orm/mysql-core";

import { auditColumns, ulid } from "./_shared";
import { tenants } from "./tenants";

export const maMemoryStores = mysqlTable(
  "ma_memory_stores",
  {
    id: ulid("id").primaryKey(),
    tenantId: ulid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 255 }).notNull(),
    description: varchar("description", { length: 1024 }),
    metadata: json("metadata").notNull().default({}).$type<Record<string, string>>(),
    status: varchar("status", { length: 16 }).notNull().default("active"),
    createdBy: varchar("created_by", { length: 26 }),
    archivedAt: datetime("archived_at", { fsp: 6 }),
    ...auditColumns,
  },
  (table) => ({
    tenantStatusIdx: index("ma_memory_stores_tenant_status_idx").on(table.tenantId, table.status, table.createdAt),
  }),
);

export const maMemories = mysqlTable(
  "ma_memories",
  {
    id: ulid("id").primaryKey(),
    tenantId: ulid("tenant_id").notNull(),
    storeId: ulid("store_id").notNull().references(() => maMemoryStores.id, { onDelete: "cascade" }),
    path: varchar("path", { length: 1024 }).notNull(),
    pathHash: varchar("path_hash", { length: 64 }).notNull(),
    content: mediumtext("content").notNull(),
    contentSha256: varchar("content_sha256", { length: 64 }).notNull(),
    sizeBytes: int("size_bytes").notNull(),
    version: int("version").notNull().default(1),
    lastActorKind: varchar("last_actor_kind", { length: 16 }).notNull(),
    lastActorUserId: varchar("last_actor_user_id", { length: 26 }),
    lastSessionId: varchar("last_session_id", { length: 26 }),
    ...auditColumns,
  },
  (table) => ({
    storePathUq: uniqueIndex("ma_memories_store_path_uq").on(table.storeId, table.pathHash),
    tenantStoreIdx: index("ma_memories_tenant_store_idx").on(table.tenantId, table.storeId, table.updatedAt),
  }),
);

export const maMemoryVersions = mysqlTable(
  "ma_memory_versions",
  {
    id: ulid("id").primaryKey(),
    tenantId: ulid("tenant_id").notNull(),
    storeId: ulid("store_id").notNull().references(() => maMemoryStores.id, { onDelete: "cascade" }),
    memoryId: ulid("memory_id").notNull(),
    version: int("version").notNull(),
    operation: varchar("operation", { length: 16 }).notNull(),
    path: varchar("path", { length: 1024 }),
    pathHash: varchar("path_hash", { length: 64 }),
    content: mediumtext("content"),
    contentSha256: varchar("content_sha256", { length: 64 }),
    sizeBytes: int("size_bytes"),
    actorKind: varchar("actor_kind", { length: 16 }).notNull(),
    actorUserId: varchar("actor_user_id", { length: 26 }),
    sourceSessionId: varchar("source_session_id", { length: 26 }),
    redacted: boolean("redacted").notNull().default(false),
    redactedAt: datetime("redacted_at", { fsp: 6 }),
    redactedBy: varchar("redacted_by", { length: 26 }),
    createdAt: datetime("created_at", { fsp: 6 }).default(sql`(UTC_TIMESTAMP(6))`).notNull(),
  },
  (table) => ({
    memoryVersionUq: uniqueIndex("ma_memory_versions_memory_version_uq").on(table.memoryId, table.version),
    storeTimeIdx: index("ma_memory_versions_store_time_idx").on(table.storeId, table.createdAt),
    tenantSessionIdx: index("ma_memory_versions_tenant_session_idx").on(table.tenantId, table.sourceSessionId),
  }),
);

export type MaMemoryStoreRow = typeof maMemoryStores.$inferSelect;
export type MaMemoryRow = typeof maMemories.$inferSelect;
export type MaMemoryVersionRow = typeof maMemoryVersions.$inferSelect;
