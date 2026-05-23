import { boolean, index, jsonb, pgTable, text, uniqueIndex, varchar } from "drizzle-orm/pg-core";

import { auditColumns, ulid } from "./_shared";
import { mcpServers } from "./mcp-servers";

export const mcpTools = pgTable(
  "mcp_tools",
  {
    id: ulid("id").primaryKey(),
    serverId: ulid("server_id")
      .notNull()
      .references(() => mcpServers.id, { onDelete: "cascade" }),
    toolName: varchar("tool_name", { length: 128 }).notNull(),
    description: text("description"),
    inputSchema: jsonb("input_schema").notNull().default({}).$type<Record<string, unknown>>(),
    outputSchema: jsonb("output_schema").$type<Record<string, unknown>>(),
    enabled: boolean("enabled").notNull().default(true),
    sourceOperationId: varchar("source_operation_id", { length: 128 }),
    metadata: jsonb("metadata").notNull().default({}).$type<Record<string, unknown>>(),
    ...auditColumns,
  },
  (table) => ({
    serverToolUq: uniqueIndex("mcp_tools_server_tool_uq").on(table.serverId, table.toolName),
    serverEnabledIdx: index("mcp_tools_server_enabled_idx").on(table.serverId, table.enabled),
  })
);

export type McpToolRow = typeof mcpTools.$inferSelect;
export type NewMcpToolRow = typeof mcpTools.$inferInsert;
