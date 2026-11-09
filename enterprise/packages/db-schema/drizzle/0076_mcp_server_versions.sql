-- 托管 MCP 工具面版本。不回填存量 server，published_version_id 为空时网关仍读 mcp_tools。
ALTER TABLE "mcp_servers" ADD COLUMN IF NOT EXISTS "published_version_id" varchar(26);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "mcp_server_versions" (
  "id" varchar(26) PRIMARY KEY NOT NULL,
  "server_id" varchar(26) NOT NULL REFERENCES "mcp_servers"("id") ON DELETE CASCADE,
  "version" integer NOT NULL,
  "tools_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "backend_config_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "content_hash" varchar(64) NOT NULL,
  "shelf_status" varchar(16) DEFAULT 'draft' NOT NULL,
  "created_by" varchar(128),
  "created_at" timestamp with time zone DEFAULT timezone('utc', now()) NOT NULL,
  "published_at" timestamp with time zone,
  CONSTRAINT "mcp_server_versions_shelf_status_chk" CHECK ("shelf_status" IN ('draft', 'published'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "mcp_server_versions_server_version_uq"
  ON "mcp_server_versions" ("server_id", "version");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mcp_server_versions_server_status_idx"
  ON "mcp_server_versions" ("server_id", "shelf_status");
