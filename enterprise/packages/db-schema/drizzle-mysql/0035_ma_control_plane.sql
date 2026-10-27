-- Managed Agents 控制面与会话面（MySQL）。
-- JSON 默认值必须写成 DEFAULT (JSON_ARRAY()) / DEFAULT (JSON_OBJECT())。
-- 不写 DEFAULT CHARSET/COLLATE，避免和外键列排序规则不一致（errno 3780）。
-- usage 是 MySQL 保留字，累计用量列名为 usage_totals。

CREATE TABLE IF NOT EXISTS `ma_environments` (
  `id` varchar(26) NOT NULL,
  `tenant_id` varchar(26) NOT NULL,
  `name` varchar(64) NOT NULL,
  `description` text,
  `type` varchar(24) NOT NULL,
  `config` json NOT NULL DEFAULT (JSON_OBJECT()),
  `status` varchar(16) NOT NULL DEFAULT 'active',
  `created_by` varchar(26),
  `created_at` datetime(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
  `updated_at` datetime(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
  CONSTRAINT `ma_environments_id` PRIMARY KEY (`id`),
  CONSTRAINT `ma_environments_tenant_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`) ON DELETE CASCADE,
  CONSTRAINT `ma_environments_tenant_name_uq` UNIQUE (`tenant_id`, `name`),
  INDEX `ma_environments_tenant_status_idx` (`tenant_id`, `status`)
);
--> statement-breakpoint
ALTER TABLE `enterprise_agents` ADD COLUMN `latest_version` int NOT NULL DEFAULT 1;
--> statement-breakpoint
ALTER TABLE `enterprise_agents` ADD COLUMN `default_environment_id` varchar(26) NULL;
--> statement-breakpoint
ALTER TABLE `enterprise_agents` ADD COLUMN `version_routing` varchar(16) NOT NULL DEFAULT 'follow_latest';
--> statement-breakpoint
ALTER TABLE `enterprise_agents` ADD COLUMN `pinned_version` int NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `enterprise_agent_versions` (
  `id` varchar(26) NOT NULL,
  `tenant_id` varchar(26) NOT NULL,
  `agent_id` varchar(26) NOT NULL,
  `version` int NOT NULL,
  `manifest` json NOT NULL,
  `manifest_hash` varchar(80) NOT NULL,
  `note` text,
  `source` varchar(16) NOT NULL DEFAULT 'admin',
  `created_by` varchar(26),
  `created_at` datetime(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
  CONSTRAINT `enterprise_agent_versions_id` PRIMARY KEY (`id`),
  CONSTRAINT `enterprise_agent_versions_agent_fk` FOREIGN KEY (`agent_id`) REFERENCES `enterprise_agents` (`id`) ON DELETE CASCADE,
  CONSTRAINT `enterprise_agent_versions_agent_version_uq` UNIQUE (`agent_id`, `version`),
  INDEX `enterprise_agent_versions_tenant_agent_idx` (`tenant_id`, `agent_id`, `created_at`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `ma_sessions` (
  `id` varchar(26) NOT NULL,
  `tenant_id` varchar(26) NOT NULL,
  `agent_id` varchar(26) NOT NULL,
  `agent_version` int NOT NULL,
  `environment_id` varchar(26),
  `created_by_user_id` varchar(26),
  `source` varchar(16) NOT NULL,
  `status` varchar(16) NOT NULL DEFAULT 'idle',
  `stop_reason` json,
  `title` varchar(255),
  `vault_ids` json NOT NULL DEFAULT (JSON_ARRAY()),
  `resources` json NOT NULL DEFAULT (JSON_ARRAY()),
  `usage_totals` json NOT NULL DEFAULT (JSON_OBJECT()),
  `last_seq` bigint NOT NULL DEFAULT 0,
  `metadata` json NOT NULL DEFAULT (JSON_OBJECT()),
  `archived_at` datetime(6),
  `created_at` datetime(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
  `updated_at` datetime(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
  CONSTRAINT `ma_sessions_id` PRIMARY KEY (`id`),
  CONSTRAINT `ma_sessions_agent_fk` FOREIGN KEY (`agent_id`) REFERENCES `enterprise_agents` (`id`) ON DELETE RESTRICT,
  INDEX `ma_sessions_tenant_id_idx` (`tenant_id`, `id`),
  INDEX `ma_sessions_tenant_agent_idx` (`tenant_id`, `agent_id`, `created_at`),
  INDEX `ma_sessions_tenant_status_idx` (`tenant_id`, `status`, `updated_at`),
  INDEX `ma_sessions_tenant_user_idx` (`tenant_id`, `created_by_user_id`, `created_at`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `ma_session_events` (
  `id` varchar(26) NOT NULL,
  `tenant_id` varchar(26) NOT NULL,
  `session_id` varchar(26) NOT NULL,
  `seq` bigint NOT NULL,
  `thread_id` varchar(26),
  `type` varchar(64) NOT NULL,
  `payload` json NOT NULL,
  `created_at` datetime(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
  `processed_at` datetime(6),
  CONSTRAINT `ma_session_events_id` PRIMARY KEY (`id`),
  CONSTRAINT `ma_session_events_session_fk` FOREIGN KEY (`session_id`) REFERENCES `ma_sessions` (`id`) ON DELETE CASCADE,
  CONSTRAINT `ma_session_events_session_seq_uq` UNIQUE (`session_id`, `seq`),
  INDEX `ma_session_events_session_type_idx` (`session_id`, `type`, `seq`),
  INDEX `ma_session_events_tenant_created_idx` (`tenant_id`, `created_at`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `ma_work_items` (
  `id` varchar(26) NOT NULL,
  `tenant_id` varchar(26) NOT NULL,
  `session_id` varchar(26) NOT NULL,
  `environment_id` varchar(26) NOT NULL,
  `status` varchar(16) NOT NULL DEFAULT 'queued',
  `claimed_by_user_id` varchar(26),
  `claimed_by_device` varchar(64),
  `claimed_at` datetime(6),
  `lease_expires_at` datetime(6),
  `last_heartbeat_at` datetime(6),
  `attempts` int NOT NULL DEFAULT 0,
  `completed_at` datetime(6),
  `error` text,
  `created_at` datetime(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
  `updated_at` datetime(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
  CONSTRAINT `ma_work_items_id` PRIMARY KEY (`id`),
  CONSTRAINT `ma_work_items_session_fk` FOREIGN KEY (`session_id`) REFERENCES `ma_sessions` (`id`) ON DELETE CASCADE,
  INDEX `ma_work_items_queue_idx` (`tenant_id`, `environment_id`, `status`, `created_at`),
  INDEX `ma_work_items_session_idx` (`session_id`, `status`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `ma_session_usage` (
  `id` varchar(26) NOT NULL,
  `tenant_id` varchar(26) NOT NULL,
  `session_id` varchar(26) NOT NULL,
  `agent_id` varchar(26) NOT NULL,
  `agent_version` int NOT NULL,
  `user_id` varchar(26),
  `model` varchar(160) NOT NULL,
  `input_tokens` bigint NOT NULL DEFAULT 0,
  `output_tokens` bigint NOT NULL DEFAULT 0,
  `cache_read_input_tokens` bigint NOT NULL DEFAULT 0,
  `tool_calls` int NOT NULL DEFAULT 0,
  `runtime_ms` bigint NOT NULL DEFAULT 0,
  `is_error` boolean NOT NULL DEFAULT false,
  `event_seq` bigint,
  `created_at` datetime(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
  CONSTRAINT `ma_session_usage_id` PRIMARY KEY (`id`),
  CONSTRAINT `ma_session_usage_session_fk` FOREIGN KEY (`session_id`) REFERENCES `ma_sessions` (`id`) ON DELETE CASCADE,
  CONSTRAINT `ma_session_usage_session_event_uq` UNIQUE (`session_id`, `event_seq`),
  INDEX `ma_session_usage_tenant_agent_idx` (`tenant_id`, `agent_id`, `created_at`),
  INDEX `ma_session_usage_tenant_user_idx` (`tenant_id`, `user_id`, `created_at`)
);
