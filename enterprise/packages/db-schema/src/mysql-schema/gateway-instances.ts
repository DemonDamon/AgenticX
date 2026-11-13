import { sql } from "drizzle-orm";
import { datetime, index, json, mysqlTable, varchar } from "drizzle-orm/mysql-core";

/** 网关副本最近一次配置生效心跳。一行一个副本。 */
export const gatewayInstances = mysqlTable(
  "gateway_instances",
  {
    instanceId: varchar("instance_id", { length: 255 }).primaryKey(),
    tenantScope: varchar("tenant_scope", { length: 255 }).default("").notNull(),
    lastSeenAt: datetime("last_seen_at", { fsp: 6 }).notNull(),
    statusJson: json("status_json").notNull().$type<Record<string, unknown>>(),
    updatedAt: datetime("updated_at", { fsp: 6 }).default(sql`(UTC_TIMESTAMP(6))`).notNull(),
  },
  (table) => ({
    lastSeenIdx: index("gateway_instances_last_seen_idx").on(table.lastSeenAt),
  }),
);

export type GatewayInstanceTableRow = typeof gatewayInstances.$inferSelect;
export type NewGatewayInstanceTableRow = typeof gatewayInstances.$inferInsert;
