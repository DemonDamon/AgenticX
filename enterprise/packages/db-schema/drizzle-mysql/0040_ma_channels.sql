-- Managed Agents IM 渠道（MySQL）。agent-runtime 只支持 PostgreSQL，MySQL 侧仅保持 schema 对齐。
CREATE TABLE IF NOT EXISTS `ma_channels` (
  `id` varchar(26) NOT NULL,
  `tenant_id` varchar(26) NOT NULL,
  `name` varchar(120) NOT NULL,
  `platform` varchar(16) NOT NULL DEFAULT 'feishu',
  `agent_id` varchar(26) NOT NULL,
  `routing` varchar(16) NOT NULL DEFAULT 'follow_latest',
  `pinned_version` int,
  `environment_id` varchar(26),
  `app_id` varchar(64) NOT NULL,
  `credential_vault_id` varchar(26) NOT NULL,
  `credential_id` varchar(26) NOT NULL,
  `owner_user_id` varchar(26) NOT NULL,
  `config` json NOT NULL DEFAULT (JSON_OBJECT()),
  `enabled` boolean NOT NULL DEFAULT true,
  `revision` int NOT NULL DEFAULT 1,
  `created_by` varchar(26),
  `created_at` datetime(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
  `updated_at` datetime(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
  CONSTRAINT `ma_channels_id` PRIMARY KEY (`id`),
  CONSTRAINT `ma_channels_tenant_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`) ON DELETE CASCADE,
  CONSTRAINT `ma_channels_agent_fk` FOREIGN KEY (`agent_id`) REFERENCES `enterprise_agents` (`id`) ON DELETE CASCADE,
  UNIQUE INDEX `ma_channels_tenant_name_uq` (`tenant_id`, `name`),
  UNIQUE INDEX `ma_channels_tenant_app_uq` (`tenant_id`, `platform`, `app_id`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `ma_channel_conversations` (
  `id` varchar(26) NOT NULL,
  `tenant_id` varchar(26) NOT NULL,
  `channel_id` varchar(26) NOT NULL,
  `conversation_key` varchar(160) NOT NULL,
  `conversation_type` varchar(16) NOT NULL,
  `session_id` varchar(26) NOT NULL,
  `agent_version` int NOT NULL,
  `last_message_at` datetime(6) NOT NULL,
  `created_at` datetime(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
  `updated_at` datetime(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
  CONSTRAINT `ma_channel_conversations_id` PRIMARY KEY (`id`),
  UNIQUE INDEX `ma_channel_conversations_key_uq` (`channel_id`, `conversation_key`),
  INDEX `ma_channel_conversations_session_idx` (`session_id`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `ma_channel_inbound` (
  `channel_id` varchar(26) NOT NULL,
  `platform_message_id` varchar(128) NOT NULL,
  `tenant_id` varchar(26) NOT NULL,
  `received_at` datetime(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
  CONSTRAINT `ma_channel_inbound_pk` PRIMARY KEY (`channel_id`, `platform_message_id`),
  INDEX `ma_channel_inbound_received_idx` (`received_at`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `ma_channel_runtime_state` (
  `channel_id` varchar(26) NOT NULL,
  `tenant_id` varchar(26) NOT NULL,
  `revision` int NOT NULL,
  `status` varchar(16) NOT NULL,
  `last_error` varchar(500),
  `last_event_at` datetime(6),
  `started_at` datetime(6),
  `updated_at` datetime(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
  CONSTRAINT `ma_channel_runtime_state_id` PRIMARY KEY (`channel_id`)
);
