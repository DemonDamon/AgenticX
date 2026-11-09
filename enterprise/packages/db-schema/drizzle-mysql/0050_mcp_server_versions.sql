-- 托管 MCP 工具面版本。不回填存量 server，published_version_id 为空时网关仍读 mcp_tools。
ALTER TABLE `mcp_servers` ADD COLUMN `published_version_id` varchar(26);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `mcp_server_versions` (
  `id` varchar(26) NOT NULL,
  `server_id` varchar(26) NOT NULL,
  `version` int NOT NULL,
  `tools_json` json NOT NULL DEFAULT (JSON_ARRAY()),
  `backend_config_json` json NOT NULL DEFAULT (JSON_OBJECT()),
  `content_hash` varchar(64) NOT NULL,
  `shelf_status` varchar(16) NOT NULL DEFAULT 'draft',
  `created_by` varchar(128),
  `created_at` datetime(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
  `published_at` datetime(6),
  CONSTRAINT `mcp_server_versions_id` PRIMARY KEY(`id`),
  CONSTRAINT `mcp_server_versions_server_version_uq` UNIQUE(`server_id`, `version`),
  CONSTRAINT `mcp_server_versions_shelf_status_chk` CHECK (`shelf_status` IN ('draft', 'published')),
  CONSTRAINT `mcp_server_versions_server_id_fk` FOREIGN KEY (`server_id`) REFERENCES `mcp_servers` (`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX `mcp_server_versions_server_status_idx`
  ON `mcp_server_versions` (`server_id`, `shelf_status`);
