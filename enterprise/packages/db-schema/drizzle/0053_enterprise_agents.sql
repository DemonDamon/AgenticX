-- 企业 Agent 注册表。
-- model 与门户模型选择器同一格式：<providerId>/<modelName>（PortalModelOption.id）。
-- capability_ids 只存 mcp:<ulid> / skill:<ulid>。
-- assignment_keys：all / 用户 ulid / email:<x> / dept:<id> / group:<ulid>。

CREATE TABLE IF NOT EXISTS "enterprise_agents" (
  "id" varchar(26) PRIMARY KEY NOT NULL,
  "tenant_id" varchar(26) NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "slug" varchar(64) NOT NULL,
  "display_name" varchar(64) NOT NULL,
  "description" text,
  "system_prompt" text DEFAULT '' NOT NULL,
  "model" varchar(160) NOT NULL,
  "runtime" varchar(24) DEFAULT 'cloud' NOT NULL,
  "capability_ids" text[] DEFAULT '{}' NOT NULL,
  "assignment_keys" text[] DEFAULT '{all}' NOT NULL,
  "status" varchar(16) DEFAULT 'active' NOT NULL,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "enterprise_agents_tenant_slug_uq"
  ON "enterprise_agents" ("tenant_id", "slug");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "enterprise_agents_tenant_status_idx"
  ON "enterprise_agents" ("tenant_id", "status");
