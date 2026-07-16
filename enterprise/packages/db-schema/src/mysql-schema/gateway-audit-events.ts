import { bigint, boolean, index, int, json, mysqlTable, datetime, uniqueIndex, varchar } from "drizzle-orm/mysql-core";
import { auditColumns, ulid } from "./_shared";
import { tenants } from "./tenants";

/** Gateway LLM / policy 审计事件（与 IAM 的 audit_events 分表） */
export const gatewayAuditEvents = mysqlTable(
  "gateway_audit_events",
  {
    id: ulid("id").primaryKey(),
    tenantId: ulid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    eventTime: datetime("event_time", { fsp: 6 }).notNull(),
    eventType: varchar("event_type", { length: 64 }).notNull(),
    userId: varchar("user_id", { length: 128 }),
    userEmail: varchar("user_email", { length: 320 }),
    departmentId: varchar("department_id", { length: 128 }),
    sessionId: varchar("session_id", { length: 128 }),
    clientType: varchar("client_type", { length: 32 }).notNull().default("web-portal"),
    clientIp: varchar("client_ip", { length: 128 }),
    provider: varchar("provider", { length: 128 }),
    model: varchar("model", { length: 128 }),
    route: varchar("route", { length: 32 }).notNull(),
    channelId: varchar("channel_id", { length: 26 }),
    channelKeyRef: varchar("channel_key_ref", { length: 128 }),
    apiTokenId: bigint("api_token_id", { mode: "number" }),
    inputTokens: int("input_tokens"),
    outputTokens: int("output_tokens"),
    totalTokens: int("total_tokens"),
    latencyMs: bigint("latency_ms", { mode: "number" }),
    digest: json("digest").$type<Record<string, unknown>>(),
    policiesHit: json("policies_hit").$type<unknown>(),
    toolsCalled: json("tools_called").$type<unknown>(),
    mcpServer: varchar("mcp_server", { length: 128 }),
    mcpToolName: varchar("mcp_tool_name", { length: 128 }),
    mcpInputHash: varchar("mcp_input_hash", { length: 128 }),
    mcpOutputHash: varchar("mcp_output_hash", { length: 128 }),
    mcpStatus: varchar("mcp_status", { length: 32 }),
    srcRegion: varchar("src_region", { length: 16 }),
    dstRegion: varchar("dst_region", { length: 16 }),
    crossBorder: boolean("cross_border"),
    residencyRule: varchar("residency_rule", { length: 64 }),
    prevChecksum: varchar("prev_checksum", { length: 128 }).notNull(),
    checksum: varchar("checksum", { length: 128 }).notNull(),
    signature: varchar("signature", { length: 256 }),
    ...auditColumns,
  },
  (table) => ({
    tenantIdIdUq: uniqueIndex("gateway_audit_events_tenant_id_id_uq").on(table.tenantId, table.id),
    tenantTimeIdx: index("gateway_audit_events_tenant_event_time_idx").on(table.tenantId, table.eventTime),
    tenantUserTimeIdx: index("gateway_audit_events_tenant_user_event_time_idx").on(
      table.tenantId,
      table.userId,
      table.eventTime
    ),
    tenantDeptTimeIdx: index("gateway_audit_events_tenant_dept_event_time_idx").on(
      table.tenantId,
      table.departmentId,
      table.eventTime
    ),
    tenantModelTimeIdx: index("gateway_audit_events_tenant_model_event_time_idx").on(
      table.tenantId,
      table.model,
      table.eventTime
    ),
    crossBorderIdx: index("gateway_audit_events_cross_border_idx").on(
      table.tenantId,
      table.crossBorder,
      table.eventTime
    ),
  })
);

export type GatewayAuditEventRow = typeof gatewayAuditEvents.$inferSelect;
export type NewGatewayAuditEventRow = typeof gatewayAuditEvents.$inferInsert;
