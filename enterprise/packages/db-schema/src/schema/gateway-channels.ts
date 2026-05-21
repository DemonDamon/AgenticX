import { integer, jsonb, pgTable, text, timestamp, uniqueIndex, varchar } from "drizzle-orm/pg-core";

import { auditColumns } from "./_shared";

/** Gateway 上游 Channel（同一逻辑 model 可绑多个 provider + key 集）。 */
export const gatewayChannels = pgTable(
  "gateway_channels",
  {
    id: varchar("id", { length: 26 }).primaryKey(),
    tenantId: varchar("tenant_id", { length: 26 }).notNull(),
    name: text("name").notNull(),
    providerType: varchar("provider_type", { length: 32 }).default("openai").notNull(),
    baseUrl: text("base_url").notNull(),
    /** AES-256-GCM 封装后的上游 API Key；可为空（走 metadata.keyRefs 环境变量）。 */
    apiKeyCipher: text("api_key_cipher").default("").notNull(),
    weight: integer("weight").default(1).notNull(),
    priority: integer("priority").default(0).notNull(),
    status: varchar("status", { length: 16 }).default("active").notNull(),
    supportedModels: jsonb("supported_models").default([]).notNull().$type<string[]>(),
    metadata: jsonb("metadata").default({}).notNull().$type<Record<string, unknown>>(),
    ...auditColumns,
  },
  (table) => ({
    tenantNameUk: uniqueIndex("gateway_channels_tenant_name_uk").on(table.tenantId, table.name),
  })
);

export type GatewayChannelRow = typeof gatewayChannels.$inferSelect;
export type NewGatewayChannelRow = typeof gatewayChannels.$inferInsert;
