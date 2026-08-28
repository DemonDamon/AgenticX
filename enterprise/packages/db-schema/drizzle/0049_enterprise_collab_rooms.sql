-- 多真人协作房间：房间 / 成员 / 消息。不改动个人聊天历史表。

CREATE TABLE IF NOT EXISTS "enterprise_collab_rooms" (
  "id" varchar(26) PRIMARY KEY NOT NULL,
  "tenant_id" varchar(26) NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "title" varchar(160) NOT NULL,
  "created_by" varchar(26) NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "archived_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "enterprise_collab_rooms_tenant_updated_idx"
  ON "enterprise_collab_rooms" ("tenant_id", "updated_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "enterprise_collab_room_members" (
  "id" varchar(26) PRIMARY KEY NOT NULL,
  "room_id" varchar(26) NOT NULL REFERENCES "enterprise_collab_rooms"("id") ON DELETE CASCADE,
  "tenant_id" varchar(26) NOT NULL,
  "member_type" varchar(16) NOT NULL,
  "member_id" varchar(64) NOT NULL,
  "display_name" varchar(64) NOT NULL,
  "room_role" varchar(16) DEFAULT 'member' NOT NULL,
  "joined_at" timestamp with time zone DEFAULT now() NOT NULL,
  "left_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "enterprise_collab_room_members_room_member_uq"
  ON "enterprise_collab_room_members" ("room_id", "member_type", "member_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "enterprise_collab_room_members_lookup_idx"
  ON "enterprise_collab_room_members" ("tenant_id", "member_id", "left_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "enterprise_collab_room_messages" (
  "id" varchar(26) PRIMARY KEY NOT NULL,
  "room_id" varchar(26) NOT NULL REFERENCES "enterprise_collab_rooms"("id") ON DELETE CASCADE,
  "tenant_id" varchar(26) NOT NULL,
  "seq" bigint NOT NULL,
  "sender_type" varchar(16) NOT NULL,
  "sender_id" varchar(64) NOT NULL,
  "sender_name" varchar(64) NOT NULL,
  "content" text NOT NULL,
  "model" varchar(160),
  "metadata" jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "enterprise_collab_room_messages_room_seq_uq"
  ON "enterprise_collab_room_messages" ("room_id", "seq");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "enterprise_collab_room_messages_room_created_idx"
  ON "enterprise_collab_room_messages" ("room_id", "created_at");
