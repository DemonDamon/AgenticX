import { index, jsonb, pgTable, varchar } from "drizzle-orm/pg-core";
import { auditColumns, ulid } from "./_shared";
import { tenants } from "./tenants";
import { users } from "./users";

export const auditEvents = pgTable(
  "audit_events",
  {
    id: ulid("id").primaryKey(),
    tenantId: ulid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    actorUserId: ulid("actor_user_id").references(() => users.id, { onDelete: "set null" }),
    eventType: varchar("event_type", { length: 64 }).notNull(),
    targetKind: varchar("target_kind", { length: 32 }).notNull(),
    targetId: varchar("target_id", { length: 64 }),
    detail: jsonb("detail").$type<Record<string, unknown>>(),
    ...auditColumns,
  },
  (table) => ({
    tenantTimeIdx: index("audit_events_tenant_time_idx").on(table.tenantId, table.createdAt),
    targetIdx: index("audit_events_target_idx").on(table.tenantId, table.targetKind, table.targetId),
  })
);

export type AuditEvent = typeof auditEvents.$inferSelect;
export type NewAuditEvent = typeof auditEvents.$inferInsert;
