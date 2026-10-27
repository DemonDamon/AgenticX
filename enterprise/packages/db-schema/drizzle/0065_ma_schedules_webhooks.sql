-- Managed Agents 定时任务与 Webhook。
-- ma_schedules / ma_webhooks：唯一写入方 admin-console（iam-core）。
-- ma_schedule_runs / ma_webhook_deliveries：唯一写入方 agent-runtime；admin-console 只读展示。
CREATE TABLE IF NOT EXISTS "ma_schedules" (
  "id" varchar(26) PRIMARY KEY NOT NULL,
  "tenant_id" varchar(26) NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "name" varchar(120) NOT NULL,
  "description" text,
  "agent_id" varchar(26) NOT NULL REFERENCES "enterprise_agents"("id") ON DELETE CASCADE,
  "version_policy" varchar(16) DEFAULT 'follow_routing' NOT NULL,
  "pinned_version" integer,
  "environment_id" varchar(26),
  "cron" varchar(120) NOT NULL,
  "timezone" varchar(64) DEFAULT 'Asia/Shanghai' NOT NULL,
  "input_template" text NOT NULL,
  "vault_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "resources" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "run_as_user_id" varchar(26) NOT NULL,
  "enabled" boolean DEFAULT true NOT NULL,
  "revision" integer DEFAULT 1 NOT NULL,
  "misfire_grace_seconds" integer DEFAULT 300 NOT NULL,
  "manual_run_requested_at" timestamp with time zone,
  "created_by" varchar(26),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ma_schedules_tenant_name_uq" ON "ma_schedules" ("tenant_id", "name");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ma_schedules_tenant_agent_idx" ON "ma_schedules" ("tenant_id", "agent_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ma_schedule_runs" (
  "id" varchar(26) PRIMARY KEY NOT NULL,
  "tenant_id" varchar(26) NOT NULL,
  "schedule_id" varchar(26) NOT NULL,
  "schedule_revision" integer NOT NULL,
  "trigger" varchar(16) NOT NULL,
  "scheduled_for" timestamp with time zone NOT NULL,
  "status" varchar(16) DEFAULT 'scheduled' NOT NULL,
  "skip_reason" varchar(32),
  "session_id" varchar(26),
  "agent_version" integer,
  "error" varchar(500),
  "started_at" timestamp with time zone,
  "finished_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ma_schedule_runs_slot_uq" ON "ma_schedule_runs" ("schedule_id", "trigger", "scheduled_for");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ma_schedule_runs_due_idx" ON "ma_schedule_runs" ("status", "scheduled_for");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ma_schedule_runs_schedule_idx" ON "ma_schedule_runs" ("tenant_id", "schedule_id", "scheduled_for");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ma_schedule_runs_session_idx" ON "ma_schedule_runs" ("session_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ma_webhooks" (
  "id" varchar(26) PRIMARY KEY NOT NULL,
  "tenant_id" varchar(26) NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "name" varchar(120) NOT NULL,
  "url" varchar(2048) NOT NULL,
  "event_types" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "agent_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "sources" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "include_result_text" boolean DEFAULT false NOT NULL,
  "enabled" boolean DEFAULT true NOT NULL,
  "secret_ciphertext" text NOT NULL,
  "wrapped_dek" text NOT NULL,
  "kek_id" varchar(32) NOT NULL,
  "secret_rotated_at" timestamp with time zone,
  "created_by" varchar(26),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ma_webhooks_tenant_name_uq" ON "ma_webhooks" ("tenant_id", "name");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ma_webhook_deliveries" (
  "id" varchar(26) PRIMARY KEY NOT NULL,
  "tenant_id" varchar(26) NOT NULL,
  "webhook_id" varchar(26) NOT NULL,
  "event_id" varchar(26) NOT NULL,
  "event_type" varchar(32) NOT NULL,
  "event_key" varchar(160) NOT NULL,
  "payload" jsonb NOT NULL,
  "status" varchar(16) DEFAULT 'pending' NOT NULL,
  "attempts" integer DEFAULT 0 NOT NULL,
  "next_attempt_at" timestamp with time zone NOT NULL,
  "locked_until" timestamp with time zone,
  "last_status_code" integer,
  "last_error" varchar(500),
  "delivered_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ma_webhook_deliveries_event_uq" ON "ma_webhook_deliveries" ("webhook_id", "event_key");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ma_webhook_deliveries_due_idx" ON "ma_webhook_deliveries" ("status", "next_attempt_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ma_webhook_deliveries_webhook_idx" ON "ma_webhook_deliveries" ("tenant_id", "webhook_id", "created_at");
