-- Managed Agents 记忆整理任务。唯一写入方：agent-runtime；admin-console 只读。
-- 输出记忆库本身仍由 admin-console 写入（经 /api/internal/ma/memory-stores/* 内部接口）。
CREATE TABLE IF NOT EXISTS `ma_memory_dreams` (
  `id` varchar(26) NOT NULL,
  `tenant_id` varchar(26) NOT NULL,
  `status` varchar(16) NOT NULL DEFAULT 'pending',
  `input_memory_store_id` varchar(26) NOT NULL,
  `output_memory_store_id` varchar(26) NOT NULL,
  `session_ids` json NOT NULL,
  `instructions` text NOT NULL,
  `model` varchar(160) NOT NULL,
  `report` json NOT NULL DEFAULT (JSON_OBJECT()),
  `error` json,
  `cancel_requested` boolean NOT NULL DEFAULT false,
  `created_by` varchar(26),
  `claimed_by` varchar(64),
  `heartbeat_at` datetime(6),
  `started_at` datetime(6),
  `finished_at` datetime(6),
  `created_at` datetime(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
  `updated_at` datetime(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
  CONSTRAINT `ma_memory_dreams_id` PRIMARY KEY (`id`),
  CONSTRAINT `ma_memory_dreams_tenant_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`) ON DELETE CASCADE,
  INDEX `ma_memory_dreams_tenant_created_idx` (`tenant_id`, `created_at`),
  INDEX `ma_memory_dreams_status_created_idx` (`status`, `created_at`),
  INDEX `ma_memory_dreams_tenant_input_idx` (`tenant_id`, `input_memory_store_id`, `created_at`)
);
