import { bigint, index, jsonb, pgTable, text, timestamp, uniqueIndex, varchar } from "drizzle-orm/pg-core";

import { auditColumns, ulid } from "./_shared";
import { tenants } from "./tenants";
import { users } from "./users";

export const enterpriseCollabRooms = pgTable(
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
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    ...auditColumns,
  },
  (table) => ({
    tenantUpdatedIdx: index("enterprise_collab_rooms_tenant_updated_idx").on(
      table.tenantId,
      table.updatedAt,
    ),
  }),
);

export const enterpriseCollabRoomMembers = pgTable(
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
    joinedAt: timestamp("joined_at", { withTimezone: true }).defaultNow().notNull(),
    leftAt: timestamp("left_at", { withTimezone: true }),
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

export const enterpriseCollabRoomMessages = pgTable(
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
    metadata: jsonb("metadata"),
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
