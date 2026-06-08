-- MCP upstream proxy registry (gateway /v1/mcp/{server_id}/* reverse proxy).
CREATE TABLE IF NOT EXISTS "enterprise_runtime_mcp_servers" (
  "tenant_id" varchar(26) PRIMARY KEY NOT NULL,
  "config" jsonb NOT NULL DEFAULT '{"servers":[]}'::jsonb,
  "updated_at" timestamp with time zone DEFAULT timezone('utc', now()) NOT NULL
);
