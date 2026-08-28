import { sql } from "drizzle-orm";
import {
  bigint,
  datetime,
  index,
  json,
  mysqlTable,
  text,
  uniqueIndex,
  varchar,
} from "drizzle-orm/mysql-core";

import { auditColumns, ulid } from "./_shared";
import { tenants } from "./tenants";
import { users } from "./users";

export const enterpriseCollabRooms = mysqlTable(
  "enterprise_collab_rooms",
  {
    id: ulid("id").primaryKey(),
    tenantId: ulid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    title: varchar("title", { length: 160 }).notNull(),
    createdBy: ulid("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    archivedAt: datetime("archived_at", { fsp: 6 }),
    ...auditColumns,
  },
  (table) => ({
    tenantUpdatedIdx: index("enterprise_collab_rooms_tenant_updated_idx").on(
      table.tenantId,
      table.updatedAt,
    ),
  }),
);

export const enterpriseCollabRoomMembers = mysqlTable(
  "enterprise_collab_room_members",
  {
    id: ulid("id").primaryKey(),
    roomId: ulid("room_id")
      .notNull()
      .references(() => enterpriseCollabRooms.id, { onDelete: "cascade" }),
    tenantId: ulid("tenant_id").notNull(),
    memberType: varchar("member_type", { length: 16 }).notNull(),
    memberId: varchar("member_id", { length: 64 }).notNull(),
    displayName: varchar("display_name", { length: 64 }).notNull(),
    roomRole: varchar("room_role", { length: 16 }).default("member").notNull(),
    joinedAt: datetime("joined_at", { fsp: 6 }).default(sql`(UTC_TIMESTAMP(6))`).notNull(),
    leftAt: datetime("left_at", { fsp: 6 }),
    ...auditColumns,
  },
  (table) => ({
    roomMemberUq: uniqueIndex("enterprise_collab_room_members_room_member_uq").on(
      table.roomId,
      table.memberType,
      table.memberId,
    ),
    lookupIdx: index("enterprise_collab_room_members_lookup_idx").on(
      table.tenantId,
      table.memberId,
      table.leftAt,
    ),
  }),
);

export const enterpriseCollabRoomMessages = mysqlTable(
  "enterprise_collab_room_messages",
  {
    id: ulid("id").primaryKey(),
    roomId: ulid("room_id")
      .notNull()
      .references(() => enterpriseCollabRooms.id, { onDelete: "cascade" }),
    tenantId: ulid("tenant_id").notNull(),
    seq: bigint("seq", { mode: "number" }).notNull(),
    senderType: varchar("sender_type", { length: 16 }).notNull(),
    senderId: varchar("sender_id", { length: 64 }).notNull(),
    senderName: varchar("sender_name", { length: 64 }).notNull(),
    content: text("content").notNull(),
    model: varchar("model", { length: 160 }),
    metadata: json("metadata"),
    ...auditColumns,
  },
  (table) => ({
    roomSeqUq: uniqueIndex("enterprise_collab_room_messages_room_seq_uq").on(
      table.roomId,
      table.seq,
    ),
    roomCreatedIdx: index("enterprise_collab_room_messages_room_created_idx").on(
      table.roomId,
      table.createdAt,
    ),
  }),
);

export type EnterpriseCollabRoomRow = typeof enterpriseCollabRooms.$inferSelect;
export type NewEnterpriseCollabRoomRow = typeof enterpriseCollabRooms.$inferInsert;
export type EnterpriseCollabRoomMemberRow = typeof enterpriseCollabRoomMembers.$inferSelect;
export type NewEnterpriseCollabRoomMemberRow = typeof enterpriseCollabRoomMembers.$inferInsert;
export type EnterpriseCollabRoomMessageRow = typeof enterpriseCollabRoomMessages.$inferSelect;
export type NewEnterpriseCollabRoomMessageRow = typeof enterpriseCollabRoomMessages.$inferInsert;
