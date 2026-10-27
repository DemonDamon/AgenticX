-- Managed Agents 控制面与会话面。
-- 写入方：ma_environments / enterprise_agent_versions / enterprise_agents 由管理台（iam-core）写；
-- ma_sessions / ma_session_events / ma_work_items / ma_session_usage 只由托管运行时写。
-- enterprise_agent_versions 行不可更新；version 从 1 递增，enterprise_agents.latest_version 做 CAS。

CREATE TABLE IF NOT EXISTS "ma_environments" (
  "id" varchar(26) PRIMARY KEY NOT NULL,
  "tenant_id" varchar(26) NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "name" varchar(64) NOT NULL,
  "description" text,
  "type" varchar(24) NOT NULL,
  "config" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "status" varchar(16) DEFAULT 'active' NOT NULL,
  "created_by" varchar(26),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ma_environments_tenant_name_uq"
  ON "ma_environments" ("tenant_id", "name");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ma_environments_tenant_status_idx"
  ON "ma_environments" ("tenant_id", "status");
--> statement-breakpoint
ALTER TABLE "enterprise_agents" ADD COLUMN IF NOT EXISTS "latest_version" integer DEFAULT 1 NOT NULL;
--> statement-breakpoint
ALTER TABLE "enterprise_agents" ADD COLUMN IF NOT EXISTS "default_environment_id" varchar(26);
--> statement-breakpoint
ALTER TABLE "enterprise_agents" ADD COLUMN IF NOT EXISTS "version_routing" varchar(16) DEFAULT 'follow_latest' NOT NULL;
--> statement-breakpoint
ALTER TABLE "enterprise_agents" ADD COLUMN IF NOT EXISTS "pinned_version" integer;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "enterprise_agent_versions" (
  "id" varchar(26) PRIMARY KEY NOT NULL,
  "tenant_id" varchar(26) NOT NULL,
  "agent_id" varchar(26) NOT NULL REFERENCES "enterprise_agents"("id") ON DELETE CASCADE,
  "version" integer NOT NULL,
  "manifest" jsonb NOT NULL,
  "manifest_hash" varchar(80) NOT NULL,
  "note" text,
  "source" varchar(16) DEFAULT 'admin' NOT NULL,
  "created_by" varchar(26),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "enterprise_agent_versions_agent_version_uq"
  ON "enterprise_agent_versions" ("agent_id", "version");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "enterprise_agent_versions_tenant_agent_idx"
  ON "enterprise_agent_versions" ("tenant_id", "agent_id", "created_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ma_sessions" (
  "id" varchar(26) PRIMARY KEY NOT NULL,
  "tenant_id" varchar(26) NOT NULL,
  "agent_id" varchar(26) NOT NULL REFERENCES "enterprise_agents"("id") ON DELETE RESTRICT,
  "agent_version" integer NOT NULL,
  "environment_id" varchar(26),
  "created_by_user_id" varchar(26),
  "source" varchar(16) NOT NULL,
  "status" varchar(16) DEFAULT 'idle' NOT NULL,
  "stop_reason" jsonb,
  "title" varchar(255),
  "vault_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "resources" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "usage_totals" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "last_seq" bigint DEFAULT 0 NOT NULL,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "archived_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ma_sessions_tenant_id_idx"
  ON "ma_sessions" ("tenant_id", "id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ma_sessions_tenant_agent_idx"
  ON "ma_sessions" ("tenant_id", "agent_id", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ma_sessions_tenant_status_idx"
  ON "ma_sessions" ("tenant_id", "status", "updated_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ma_sessions_tenant_user_idx"
  ON "ma_sessions" ("tenant_id", "created_by_user_id", "created_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ma_session_events" (
  "id" varchar(26) PRIMARY KEY NOT NULL,
  "tenant_id" varchar(26) NOT NULL,
  "session_id" varchar(26) NOT NULL REFERENCES "ma_sessions"("id") ON DELETE CASCADE,
  "seq" bigint NOT NULL,
  "thread_id" varchar(26),
  "type" varchar(64) NOT NULL,
  "payload" jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "processed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ma_session_events_session_seq_uq"
  ON "ma_session_events" ("session_id", "seq");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ma_session_events_session_type_idx"
  ON "ma_session_events" ("session_id", "type", "seq");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ma_session_events_tenant_created_idx"
  ON "ma_session_events" ("tenant_id", "created_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ma_work_items" (
  "id" varchar(26) PRIMARY KEY NOT NULL,
  "tenant_id" varchar(26) NOT NULL,
  "session_id" varchar(26) NOT NULL REFERENCES "ma_sessions"("id") ON DELETE CASCADE,
  "environment_id" varchar(26) NOT NULL,
  "status" varchar(16) DEFAULT 'queued' NOT NULL,
  "claimed_by_user_id" varchar(26),
  "claimed_by_device" varchar(64),
  "claimed_at" timestamp with time zone,
  "lease_expires_at" timestamp with time zone,
  "last_heartbeat_at" timestamp with time zone,
  "attempts" integer DEFAULT 0 NOT NULL,
  "completed_at" timestamp with time zone,
  "error" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ma_work_items_queue_idx"
  ON "ma_work_items" ("tenant_id", "environment_id", "status", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ma_work_items_session_idx"
  ON "ma_work_items" ("session_id", "status");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ma_session_usage" (
  "id" varchar(26) PRIMARY KEY NOT NULL,
  "tenant_id" varchar(26) NOT NULL,
  "session_id" varchar(26) NOT NULL REFERENCES "ma_sessions"("id") ON DELETE CASCADE,
  "agent_id" varchar(26) NOT NULL,
  "agent_version" integer NOT NULL,
  "user_id" varchar(26),
  "model" varchar(160) NOT NULL,
  "input_tokens" bigint DEFAULT 0 NOT NULL,
  "output_tokens" bigint DEFAULT 0 NOT NULL,
  "cache_read_input_tokens" bigint DEFAULT 0 NOT NULL,
  "tool_calls" integer DEFAULT 0 NOT NULL,
  "runtime_ms" bigint DEFAULT 0 NOT NULL,
  "is_error" boolean DEFAULT false NOT NULL,
  "event_seq" bigint,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ma_session_usage_session_event_uq"
  ON "ma_session_usage" ("session_id", "event_seq");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ma_session_usage_tenant_agent_idx"
  ON "ma_session_usage" ("tenant_id", "agent_id", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ma_session_usage_tenant_user_idx"
  ON "ma_session_usage" ("tenant_id", "user_id", "created_at");
