-- 项目协作：项目表、群层级（主群 / 小群 / 单聊）、消息客户端去重。

CREATE TABLE IF NOT EXISTS "enterprise_projects" (
  "id" varchar(26) PRIMARY KEY NOT NULL,
  "tenant_id" varchar(26) NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "name" varchar(32) NOT NULL,
  "instructions" text,
  "owner_user_id" varchar(26) NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "dept_id" varchar(26),
  "main_room_id" varchar(26),
  "settings" jsonb,
  "archived_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "enterprise_projects_tenant_updated_idx"
  ON "enterprise_projects" ("tenant_id", "updated_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "enterprise_projects_tenant_dept_idx"
  ON "enterprise_projects" ("tenant_id", "dept_id");
--> statement-breakpoint
ALTER TABLE "enterprise_collab_rooms" ADD COLUMN IF NOT EXISTS "project_id" varchar(26) REFERENCES "enterprise_projects"("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "enterprise_collab_rooms" ADD COLUMN IF NOT EXISTS "parent_room_id" varchar(26);
--> statement-breakpoint
ALTER TABLE "enterprise_collab_rooms" ADD COLUMN IF NOT EXISTS "room_kind" varchar(16) DEFAULT 'room' NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "enterprise_collab_rooms_project_idx"
  ON "enterprise_collab_rooms" ("project_id", "room_kind");
--> statement-breakpoint
ALTER TABLE "enterprise_collab_room_messages" ADD COLUMN IF NOT EXISTS "client_msg_id" varchar(64);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "enterprise_collab_room_messages_room_client_uq"
  ON "enterprise_collab_room_messages" ("room_id", "client_msg_id");
