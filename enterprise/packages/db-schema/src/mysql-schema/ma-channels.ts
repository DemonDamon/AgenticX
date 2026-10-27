/**
 * 托管 IM 渠道（MySQL）。ma_channels 只由 admin-console 写入。
 * 会话映射、入站去重和连接状态只由 agent-runtime 写入，因此不加外键。
 */
import { sql } from "drizzle-orm";
import { boolean, datetime, index, int, json, mysqlTable, primaryKey, uniqueIndex, varchar } from "drizzle-orm/mysql-core";

import { enterpriseAgents } from "./agents";
import { auditColumns, ulid } from "./_shared";
import { tenants } from "./tenants";

export type MaChannelConfig = {
  idle_reset_hours: number;
  open_base_url: string;
};

export const maChannels = mysqlTable(
  "ma_channels",
  {
    id: ulid("id").primaryKey(),
    tenantId: ulid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 120 }).notNull(),
    platform: varchar("platform", { length: 16 }).notNull().default("feishu"),
    agentId: ulid("agent_id").notNull().references(() => enterpriseAgents.id, { onDelete: "cascade" }),
    routing: varchar("routing", { length: 16 }).notNull().default("follow_latest"),
    pinnedVersion: int("pinned_version"),
    environmentId: varchar("environment_id", { length: 26 }),
    appId: varchar("app_id", { length: 64 }).notNull(),
    credentialVaultId: varchar("credential_vault_id", { length: 26 }).notNull(),
    credentialId: varchar("credential_id", { length: 26 }).notNull(),
    ownerUserId: varchar("owner_user_id", { length: 26 }).notNull(),
    config: json("config").notNull().default({}).$type<MaChannelConfig>(),
    enabled: boolean("enabled").notNull().default(true),
    revision: int("revision").notNull().default(1),
    createdBy: varchar("created_by", { length: 26 }),
    ...auditColumns,
  },
  (table) => ({
    tenantNameUq: uniqueIndex("ma_channels_tenant_name_uq").on(table.tenantId, table.name),
    tenantAppUq: uniqueIndex("ma_channels_tenant_app_uq").on(table.tenantId, table.platform, table.appId),
  }),
);

export const maChannelConversations = mysqlTable(
  "ma_channel_conversations",
  {
    id: ulid("id").primaryKey(),
    tenantId: ulid("tenant_id").notNull(),
    channelId: ulid("channel_id").notNull(),
    conversationKey: varchar("conversation_key", { length: 160 }).notNull(),
    conversationType: varchar("conversation_type", { length: 16 }).notNull(),
    sessionId: varchar("session_id", { length: 26 }).notNull(),
    agentVersion: int("agent_version").notNull(),
    lastMessageAt: datetime("last_message_at", { fsp: 6 }).notNull(),
    ...auditColumns,
  },
  (table) => ({
    keyUq: uniqueIndex("ma_channel_conversations_key_uq").on(table.channelId, table.conversationKey),
    sessionIdx: index("ma_channel_conversations_session_idx").on(table.sessionId),
  }),
);

export const maChannelInbound = mysqlTable(
  "ma_channel_inbound",
  {
    channelId: varchar("channel_id", { length: 26 }).notNull(),
    platformMessageId: varchar("platform_message_id", { length: 128 }).notNull(),
    tenantId: varchar("tenant_id", { length: 26 }).notNull(),
    receivedAt: datetime("received_at", { fsp: 6 }).default(sql`(UTC_TIMESTAMP(6))`).notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.channelId, table.platformMessageId], name: "ma_channel_inbound_pk" }),
    receivedIdx: index("ma_channel_inbound_received_idx").on(table.receivedAt),
  }),
);

export const maChannelRuntimeState = mysqlTable("ma_channel_runtime_state", {
  channelId: varchar("channel_id", { length: 26 }).primaryKey(),
  tenantId: varchar("tenant_id", { length: 26 }).notNull(),
  revision: int("revision").notNull(),
  status: varchar("status", { length: 16 }).notNull(),
  lastError: varchar("last_error", { length: 500 }),
  lastEventAt: datetime("last_event_at", { fsp: 6 }),
  startedAt: datetime("started_at", { fsp: 6 }),
  updatedAt: datetime("updated_at", { fsp: 6 }).default(sql`(UTC_TIMESTAMP(6))`).notNull(),
});

export type MaChannelRow = typeof maChannels.$inferSelect;
export type MaChannelConversationRow = typeof maChannelConversations.$inferSelect;
export type MaChannelRuntimeStateRow = typeof maChannelRuntimeState.$inferSelect;
