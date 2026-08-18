-- 用户组提成一等主体：此前只是 enterprise_runtime_token_quotas.config 里的
-- groups[<id>].memberIds，没有表、没有外键，删人无法级联，能力包也无从引用。

CREATE TABLE IF NOT EXISTS "enterprise_user_groups" (
  "id" varchar(26) PRIMARY KEY NOT NULL,
  "tenant_id" varchar(26) NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "name" varchar(64) NOT NULL,
  "description" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "enterprise_user_groups_tenant_name_uq"
  ON "enterprise_user_groups" ("tenant_id", "name");

CREATE TABLE IF NOT EXISTS "enterprise_user_group_members" (
  "group_id" varchar(26) NOT NULL REFERENCES "enterprise_user_groups"("id") ON DELETE CASCADE,
  "user_id" varchar(26) NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "enterprise_user_group_members_pk" PRIMARY KEY ("group_id", "user_id")
);
CREATE INDEX IF NOT EXISTS "enterprise_user_group_members_user_idx"
  ON "enterprise_user_group_members" ("user_id");
