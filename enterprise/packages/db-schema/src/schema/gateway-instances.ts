import { index, jsonb, pgTable, timestamp, varchar } from "drizzle-orm/pg-core";

/** 网关副本最近一次配置生效心跳。一行一个副本。 */
export const gatewayInstances = pgTable(
  "gateway_instances",
  {
    instanceId: varchar("instance_id", { length: 255 }).primaryKey(),
    tenantScope: varchar("tenant_scope", { length: 255 }).default("").notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull(),
    statusJson: jsonb("status_json").notNull().$type<Record<string, unknown>>(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    lastSeenIdx: index("gateway_instances_last_seen_idx").on(table.lastSeenAt),
  }),
);

export type GatewayInstanceTableRow = typeof gatewayInstances.$inferSelect;
export type NewGatewayInstanceTableRow = typeof gatewayInstances.$inferInsert;
