-- Managed Agents IM 渠道。ma_channels：唯一写入方 admin-console。
-- ma_channel_conversations / ma_channel_inbound / ma_channel_runtime_state：唯一写入方 agent-runtime。
CREATE TABLE IF NOT EXISTS "ma_channels" (
  "id" varchar(26) PRIMARY KEY NOT NULL,
  "tenant_id" varchar(26) NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "name" varchar(120) NOT NULL,
  "platform" varchar(16) DEFAULT 'feishu' NOT NULL,
  "agent_id" varchar(26) NOT NULL REFERENCES "enterprise_agents"("id") ON DELETE CASCADE,
  "routing" varchar(16) DEFAULT 'follow_latest' NOT NULL,
  "pinned_version" integer,
  "environment_id" varchar(26),
  "app_id" varchar(64) NOT NULL,
  "credential_vault_id" varchar(26) NOT NULL,
  "credential_id" varchar(26) NOT NULL,
  "owner_user_id" varchar(26) NOT NULL,
  "config" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "enabled" boolean DEFAULT true NOT NULL,
  "revision" integer DEFAULT 1 NOT NULL,
  "created_by" varchar(26),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ma_channels_tenant_name_uq" ON "ma_channels" ("tenant_id", "name");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ma_channels_tenant_app_uq" ON "ma_channels" ("tenant_id", "platform", "app_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ma_channel_conversations" (
  "id" varchar(26) PRIMARY KEY NOT NULL,
  "tenant_id" varchar(26) NOT NULL,
  "channel_id" varchar(26) NOT NULL,
  "conversation_key" varchar(160) NOT NULL,
  "conversation_type" varchar(16) NOT NULL,
  "session_id" varchar(26) NOT NULL,
  "agent_version" integer NOT NULL,
  "last_message_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ma_channel_conversations_key_uq" ON "ma_channel_conversations" ("channel_id", "conversation_key");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ma_channel_conversations_session_idx" ON "ma_channel_conversations" ("session_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ma_channel_inbound" (
  "channel_id" varchar(26) NOT NULL,
  "platform_message_id" varchar(128) NOT NULL,
  "tenant_id" varchar(26) NOT NULL,
  "received_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "ma_channel_inbound_pk" PRIMARY KEY ("channel_id", "platform_message_id")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ma_channel_inbound_received_idx" ON "ma_channel_inbound" ("received_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ma_channel_runtime_state" (
  "channel_id" varchar(26) PRIMARY KEY NOT NULL,
  "tenant_id" varchar(26) NOT NULL,
  "revision" integer NOT NULL,
  "status" varchar(16) NOT NULL,
  "last_error" varchar(500),
  "last_event_at" timestamp with time zone,
  "started_at" timestamp with time zone,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
