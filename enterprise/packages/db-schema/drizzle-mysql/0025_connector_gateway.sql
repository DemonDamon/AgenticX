-- 连接器网关：定义目录、加密连接、审计维度。
CREATE TABLE IF NOT EXISTS `connector_definitions` (
  `tenant_id` varchar(26) NOT NULL,
  `connector_id` varchar(64) NOT NULL,
  `definition` json NOT NULL,
  `status` varchar(16) DEFAULT 'active' NOT NULL,
  `created_at` datetime(6) DEFAULT CURRENT_TIMESTAMP(6) NOT NULL,
  `updated_at` datetime(6) DEFAULT CURRENT_TIMESTAMP(6) NOT NULL,
  PRIMARY KEY (`tenant_id`, `connector_id`),
  KEY `connector_definitions_tenant_status_idx` (`tenant_id`, `status`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `connector_connections` (
  `id` varchar(26) PRIMARY KEY NOT NULL,
  `tenant_id` varchar(26) NOT NULL,
  `connector_id` varchar(64) NOT NULL,
  `name` varchar(128) NOT NULL,
  `auth_type` varchar(16) NOT NULL,
  `granted_scopes` json NOT NULL,
  `encrypted_secret` text,
  `status` varchar(16) DEFAULT 'active' NOT NULL,
  `created_at` datetime(6) DEFAULT CURRENT_TIMESTAMP(6) NOT NULL,
  `updated_at` datetime(6) DEFAULT CURRENT_TIMESTAMP(6) NOT NULL,
  KEY `connector_connections_tenant_connector_idx` (`tenant_id`, `connector_id`)
);
--> statement-breakpoint
ALTER TABLE `gateway_audit_events` ADD COLUMN `connector_execution_id` varchar(64);
--> statement-breakpoint
ALTER TABLE `gateway_audit_events` ADD COLUMN `connector_action_id` varchar(128);
--> statement-breakpoint
ALTER TABLE `gateway_audit_events` ADD COLUMN `connector_connection_id` varchar(64);
