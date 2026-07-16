import { bigint, boolean, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, varchar } from "drizzle-orm/pg-core";
import { auditColumns, ulid } from "./_shared";
import { tenants } from "./tenants";

/** Gateway LLM / policy 审计事件（与 IAM 的 audit_events 分表） */
export const gatewayAuditEvents = pgTable(
  "gateway_audit_events",
  {
    id: ulid("id").primaryKey(),
    tenantId: ulid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    eventTime: timestamp("event_time", { withTimezone: true }).notNull(),
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
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    totalTokens: integer("total_tokens"),
    latencyMs: bigint("latency_ms", { mode: "number" }),
    digest: jsonb("digest").$type<Record<string, unknown>>(),
    policiesHit: jsonb("policies_hit").$type<unknown>(),
    toolsCalled: jsonb("tools_called").$type<unknown>(),
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
    checksumVersion: varchar("checksum_version", { length: 16 }).notNull().default("v1"),
    checksumPayload: text("checksum_payload"),
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
    policiesHitGin: index("gateway_audit_events_policies_hit_gin").using("gin", table.policiesHit),
    crossBorderIdx: index("gateway_audit_events_cross_border_idx").on(
      table.tenantId,
      table.crossBorder,
      table.eventTime
    ),
  })
);

export type GatewayAuditEventRow = typeof gatewayAuditEvents.$inferSelect;
export type NewGatewayAuditEventRow = typeof gatewayAuditEvents.$inferInsert;
