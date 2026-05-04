import { bigint, index, integer, jsonb, pgTable, timestamp, uniqueIndex, varchar } from "drizzle-orm/pg-core";
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
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    totalTokens: integer("total_tokens"),
    latencyMs: bigint("latency_ms", { mode: "number" }),
    digest: jsonb("digest").$type<Record<string, unknown>>(),
    policiesHit: jsonb("policies_hit").$type<unknown>(),
    toolsCalled: jsonb("tools_called").$type<unknown>(),
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
    policiesHitGin: index("gateway_audit_events_policies_hit_gin").using("gin", table.policiesHit),
  })
);

export type GatewayAuditEventRow = typeof gatewayAuditEvents.$inferSelect;
export type NewGatewayAuditEventRow = typeof gatewayAuditEvents.$inferInsert;
