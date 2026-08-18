-- 企业能力包：Skill 注册表 + 能力包 + 成员 + 分配范围 + 用户关闭记录。
-- 能力统一按 `mcp:<ulid>` / `skill:<ulid>` 引用，不用可变的 name/slug。

CREATE TABLE IF NOT EXISTS "enterprise_skills" (
  "id" varchar(26) PRIMARY KEY NOT NULL,
  "tenant_id" varchar(26) NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "slug" varchar(128) NOT NULL,
  "display_name" varchar(128),
  "description" text,
  "version" varchar(32) DEFAULT '0.0.0' NOT NULL,
  "bundle_uri" text,
  "bundle_digest" varchar(128),
  "required_capabilities" text[] DEFAULT '{}' NOT NULL,
  "status" varchar(16) DEFAULT 'active' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "enterprise_skills_tenant_slug_uq"
  ON "enterprise_skills" ("tenant_id", "slug");
CREATE INDEX IF NOT EXISTS "enterprise_skills_tenant_status_idx"
  ON "enterprise_skills" ("tenant_id", "status");

CREATE TABLE IF NOT EXISTS "enterprise_capability_packs" (
  "id" varchar(26) PRIMARY KEY NOT NULL,
  "tenant_id" varchar(26) NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "slug" varchar(128) NOT NULL,
  "display_name" varchar(128),
  "description" text,
  "status" varchar(16) DEFAULT 'active' NOT NULL,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "enterprise_capability_packs_tenant_slug_uq"
  ON "enterprise_capability_packs" ("tenant_id", "slug");
CREATE INDEX IF NOT EXISTS "enterprise_capability_packs_tenant_status_idx"
  ON "enterprise_capability_packs" ("tenant_id", "status");

CREATE TABLE IF NOT EXISTS "enterprise_capability_pack_members" (
  "pack_id" varchar(26) NOT NULL REFERENCES "enterprise_capability_packs"("id") ON DELETE CASCADE,
  "capability_id" varchar(64) NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "enterprise_capability_pack_members_pkey" PRIMARY KEY ("pack_id", "capability_id")
);
CREATE INDEX IF NOT EXISTS "enterprise_capability_pack_members_capability_idx"
  ON "enterprise_capability_pack_members" ("capability_id");

CREATE TABLE IF NOT EXISTS "enterprise_capability_assignments" (
  "tenant_id" varchar(26) NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "pack_id" varchar(26) NOT NULL REFERENCES "enterprise_capability_packs"("id") ON DELETE CASCADE,
  "assignment_key" varchar(128) NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "enterprise_capability_assignments_pkey" PRIMARY KEY ("tenant_id", "pack_id", "assignment_key")
);
CREATE INDEX IF NOT EXISTS "enterprise_capability_assignments_tenant_key_idx"
  ON "enterprise_capability_assignments" ("tenant_id", "assignment_key");

CREATE TABLE IF NOT EXISTS "enterprise_capability_opt_outs" (
  "tenant_id" varchar(26) NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "user_id" varchar(64) NOT NULL,
  "capability_id" varchar(64) NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "enterprise_capability_opt_outs_pkey" PRIMARY KEY ("tenant_id", "user_id", "capability_id")
);
