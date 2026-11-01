-- ECP E3: approval workflow (requests, steps, presets, settings).

CREATE TABLE IF NOT EXISTS "approval_workflow_presets" (
  "id" varchar(26) PRIMARY KEY NOT NULL,
  "slug" varchar(64) NOT NULL,
  "display_name" varchar(128) NOT NULL,
  "step_definitions" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "approval_workflow_presets_slug_uq"
  ON "approval_workflow_presets" ("slug");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "approval_requests" (
  "id" varchar(26) PRIMARY KEY NOT NULL,
  "tenant_id" varchar(26) NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "preset_slug" varchar(64) NOT NULL,
  "resource_type" varchar(48) NOT NULL,
  "resource_id" varchar(26) NOT NULL,
  "action" varchar(32) NOT NULL,
  "status" varchar(16) DEFAULT 'pending' NOT NULL,
  "requester_user_id" varchar(26),
  "requester_email" varchar(256),
  "rejection_reason" text,
  "context_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "consumed_at" varchar(32),
  "completed_at" varchar(32),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "approval_requests_tenant_status_idx"
  ON "approval_requests" ("tenant_id", "status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "approval_requests_resource_idx"
  ON "approval_requests" ("resource_type", "resource_id", "action");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "approval_steps" (
  "id" varchar(26) PRIMARY KEY NOT NULL,
  "request_id" varchar(26) NOT NULL REFERENCES "approval_requests"("id") ON DELETE CASCADE,
  "step_order" integer NOT NULL,
  "step_kind" varchar(16) NOT NULL,
  "actor_scope" varchar(32),
  "status" varchar(16) DEFAULT 'pending' NOT NULL,
  "decision_note" text,
  "decided_by_user_id" varchar(26),
  "decided_by_email" varchar(256),
  "decided_at" varchar(32),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "approval_steps_request_order_uq"
  ON "approval_steps" ("request_id", "step_order");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "approval_steps_request_idx"
  ON "approval_steps" ("request_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ecp_approval_settings" (
  "tenant_id" varchar(26) PRIMARY KEY NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "skill_publish_preset_slug" varchar(64),
  "platform_introduce_preset_slug" varchar(64),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ecp_platform_approval_settings" (
  "id" varchar(32) PRIMARY KEY NOT NULL,
  "catalog_publish_preset_slug" varchar(64),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
INSERT INTO "approval_workflow_presets" (
  "id",
  "slug",
  "display_name",
  "step_definitions",
  "created_at",
  "updated_at"
)
SELECT
  '01ECPPRESETENTERPRISEONLYA',
  'enterprise_admin_only',
  '企管单级',
  '[{"kind":"auto_scan","actorScope":null},{"kind":"manual","actorScope":"enterprise_admin"}]'::jsonb,
  now(),
  now()
WHERE NOT EXISTS (
  SELECT 1 FROM "approval_workflow_presets" WHERE "slug" = 'enterprise_admin_only'
);
--> statement-breakpoint
INSERT INTO "approval_workflow_presets" (
  "id",
  "slug",
  "display_name",
  "step_definitions",
  "created_at",
  "updated_at"
)
SELECT
  '01ECPPRESETENTERPRISEPLAT',
  'enterprise_admin_platform',
  '企管+平台',
  '[{"kind":"auto_scan","actorScope":null},{"kind":"manual","actorScope":"enterprise_admin"},{"kind":"manual","actorScope":"platform_operator"}]'::jsonb,
  now(),
  now()
WHERE NOT EXISTS (
  SELECT 1 FROM "approval_workflow_presets" WHERE "slug" = 'enterprise_admin_platform'
);
--> statement-breakpoint
INSERT INTO "ecp_platform_approval_settings" (
  "id",
  "catalog_publish_preset_slug",
  "created_at",
  "updated_at"
)
SELECT 'default', NULL, now(), now()
WHERE NOT EXISTS (
  SELECT 1 FROM "ecp_platform_approval_settings" WHERE "id" = 'default'
);
