-- 用户组提成一等主体：`group:<ulid>` 与 all / dept:<id> / 用户 ulid 并列。

CREATE TABLE IF NOT EXISTS "enterprise_user_groups" (
  "id" varchar(26) PRIMARY KEY NOT NULL,
  "tenant_id" varchar(26) NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "name" varchar(64) NOT NULL,
  "description" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "enterprise_user_groups_tenant_name_uq"
  ON "enterprise_user_groups" ("tenant_id", "name");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "enterprise_user_group_members" (
  "group_id" varchar(26) NOT NULL REFERENCES "enterprise_user_groups"("id") ON DELETE CASCADE,
  "user_id" varchar(26) NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "enterprise_user_group_members_pk" PRIMARY KEY ("group_id", "user_id")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "enterprise_user_group_members_user_idx"
  ON "enterprise_user_group_members" ("user_id");
