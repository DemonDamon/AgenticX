-- Managed Agents 记忆库（MySQL）。content 用 mediumtext（text 上限 65535 字节 < 100 KiB）。
CREATE TABLE IF NOT EXISTS `ma_memory_stores` (
  `id` varchar(26) NOT NULL,
  `tenant_id` varchar(26) NOT NULL,
  `name` varchar(255) NOT NULL,
  `description` varchar(1024),
  `metadata` json NOT NULL DEFAULT (JSON_OBJECT()),
  `status` varchar(16) NOT NULL DEFAULT 'active',
  `created_by` varchar(26),
  `archived_at` datetime(6),
  `created_at` datetime(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
  `updated_at` datetime(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
  CONSTRAINT `ma_memory_stores_id` PRIMARY KEY (`id`),
  CONSTRAINT `ma_memory_stores_tenant_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`) ON DELETE CASCADE,
  INDEX `ma_memory_stores_tenant_status_idx` (`tenant_id`, `status`, `created_at`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `ma_memories` (
  `id` varchar(26) NOT NULL,
  `tenant_id` varchar(26) NOT NULL,
  `store_id` varchar(26) NOT NULL,
  `path` varchar(1024) NOT NULL,
  `path_hash` varchar(64) NOT NULL,
  `content` mediumtext NOT NULL,
  `content_sha256` varchar(64) NOT NULL,
  `size_bytes` int NOT NULL,
  `version` int NOT NULL DEFAULT 1,
  `last_actor_kind` varchar(16) NOT NULL,
  `last_actor_user_id` varchar(26),
  `last_session_id` varchar(26),
  `created_at` datetime(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
  `updated_at` datetime(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
  CONSTRAINT `ma_memories_id` PRIMARY KEY (`id`),
  CONSTRAINT `ma_memories_store_fk` FOREIGN KEY (`store_id`) REFERENCES `ma_memory_stores` (`id`) ON DELETE CASCADE,
  CONSTRAINT `ma_memories_store_path_uq` UNIQUE (`store_id`, `path_hash`),
  INDEX `ma_memories_tenant_store_idx` (`tenant_id`, `store_id`, `updated_at`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `ma_memory_versions` (
  `id` varchar(26) NOT NULL,
  `tenant_id` varchar(26) NOT NULL,
  `store_id` varchar(26) NOT NULL,
  `memory_id` varchar(26) NOT NULL,
  `version` int NOT NULL,
  `operation` varchar(16) NOT NULL,
  `path` varchar(1024),
  `path_hash` varchar(64),
  `content` mediumtext,
  `content_sha256` varchar(64),
  `size_bytes` int,
  `actor_kind` varchar(16) NOT NULL,
  `actor_user_id` varchar(26),
  `source_session_id` varchar(26),
  `redacted` boolean NOT NULL DEFAULT false,
  `redacted_at` datetime(6),
  `redacted_by` varchar(26),
  `created_at` datetime(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
  CONSTRAINT `ma_memory_versions_id` PRIMARY KEY (`id`),
  CONSTRAINT `ma_memory_versions_store_fk` FOREIGN KEY (`store_id`) REFERENCES `ma_memory_stores` (`id`) ON DELETE CASCADE,
  CONSTRAINT `ma_memory_versions_memory_version_uq` UNIQUE (`memory_id`, `version`),
  INDEX `ma_memory_versions_store_time_idx` (`store_id`, `created_at`),
  INDEX `ma_memory_versions_tenant_session_idx` (`tenant_id`, `source_session_id`)
);
