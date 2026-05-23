CREATE TABLE IF NOT EXISTS "mcp_servers" (
  "id" varchar(26) PRIMARY KEY NOT NULL,
  "tenant_id" varchar(26) NOT NULL,
  "name" varchar(64) NOT NULL,
  "display_name" varchar(128),
  "transport" varchar(32) DEFAULT 'streamable-http' NOT NULL,
  "backend_type" varchar(32) NOT NULL,
  "backend_config" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "required_scopes" text[] DEFAULT ARRAY[]::text[] NOT NULL,
  "status" varchar(16) DEFAULT 'active' NOT NULL,
  "rate_limit" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT timezone('utc', now()) NOT NULL,
  "updated_at" timestamp with time zone DEFAULT timezone('utc', now()) NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "mcp_servers_tenant_name_uq" ON "mcp_servers" ("tenant_id", "name");
CREATE INDEX IF NOT EXISTS "mcp_servers_tenant_status_idx" ON "mcp_servers" ("tenant_id", "status");

CREATE TABLE IF NOT EXISTS "mcp_tools" (
  "id" varchar(26) PRIMARY KEY NOT NULL,
  "server_id" varchar(26) NOT NULL REFERENCES "mcp_servers"("id") ON DELETE CASCADE,
  "tool_name" varchar(128) NOT NULL,
  "description" text,
  "input_schema" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "output_schema" jsonb,
  "enabled" boolean DEFAULT true NOT NULL,
  "source_operation_id" varchar(128),
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT timezone('utc', now()) NOT NULL,
  "updated_at" timestamp with time zone DEFAULT timezone('utc', now()) NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "mcp_tools_server_tool_uq" ON "mcp_tools" ("server_id", "tool_name");
CREATE INDEX IF NOT EXISTS "mcp_tools_server_enabled_idx" ON "mcp_tools" ("server_id", "enabled");

ALTER TABLE "gateway_audit_events" ADD COLUMN IF NOT EXISTS "mcp_server" varchar(128);
ALTER TABLE "gateway_audit_events" ADD COLUMN IF NOT EXISTS "mcp_tool_name" varchar(128);
ALTER TABLE "gateway_audit_events" ADD COLUMN IF NOT EXISTS "mcp_input_hash" varchar(128);
ALTER TABLE "gateway_audit_events" ADD COLUMN IF NOT EXISTS "mcp_output_hash" varchar(128);
ALTER TABLE "gateway_audit_events" ADD COLUMN IF NOT EXISTS "mcp_status" varchar(32);

CREATE INDEX IF NOT EXISTS "gateway_audit_events_mcp_server_time_idx"
  ON "gateway_audit_events" ("tenant_id", "mcp_server", "event_time");
