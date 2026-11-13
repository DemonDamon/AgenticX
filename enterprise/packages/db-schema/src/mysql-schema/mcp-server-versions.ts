import { sql } from "drizzle-orm";
import { datetime, index, int, json, mysqlTable, uniqueIndex, varchar } from "drizzle-orm/mysql-core";

import { ulid } from "./_shared";
import { mcpServers } from "./mcp-servers";

/** 托管 MCP 工具面版本。网关只读 mcp_servers.published_version_id 指向的 published 行。 */
export const mcpServerVersions = mysqlTable(
  "mcp_server_versions",
  {
    id: ulid("id").primaryKey(),
    serverId: ulid("server_id")
      .notNull()
      .references(() => mcpServers.id, { onDelete: "cascade" }),
    version: int("version").notNull(),
    toolsJson: json("tools_json").notNull().default([]).$type<unknown[]>(),
    backendConfigJson: json("backend_config_json").notNull().default({}).$type<Record<string, unknown>>(),
    contentHash: varchar("content_hash", { length: 64 }).notNull(),
    shelfStatus: varchar("shelf_status", { length: 16 }).notNull().default("draft"),
    createdBy: varchar("created_by", { length: 128 }),
    createdAt: datetime("created_at", { fsp: 6 }).default(sql`(UTC_TIMESTAMP(6))`).notNull(),
    publishedAt: datetime("published_at", { fsp: 6 }),
  },
  (table) => ({
    serverVersionUq: uniqueIndex("mcp_server_versions_server_version_uq").on(table.serverId, table.version),
    serverStatusIdx: index("mcp_server_versions_server_status_idx").on(table.serverId, table.shelfStatus),
  }),
);

export type McpServerVersionRow = typeof mcpServerVersions.$inferSelect;
export type NewMcpServerVersionRow = typeof mcpServerVersions.$inferInsert;
