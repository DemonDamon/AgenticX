-- Managed Agents 评测与自迭代（MySQL）。
-- query / expected_answer / answer 用 mediumtext（用例上限 20000 字，UTF-8 最坏超过 text 的 64 KiB）。
CREATE TABLE IF NOT EXISTS `ma_eval_datasets` (
  `id` varchar(26) NOT NULL,
  `tenant_id` varchar(26) NOT NULL,
  `name` varchar(128) NOT NULL,
  `description` varchar(1024),
  `item_count` int NOT NULL DEFAULT 0,
  `created_by` varchar(26),
  `created_at` datetime(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
  `updated_at` datetime(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
  CONSTRAINT `ma_eval_datasets_id` PRIMARY KEY (`id`),
  CONSTRAINT `ma_eval_datasets_tenant_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`) ON DELETE CASCADE,
  UNIQUE INDEX `ma_eval_datasets_tenant_name_uq` (`tenant_id`, `name`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `ma_eval_dataset_items` (
  `id` varchar(26) NOT NULL,
  `tenant_id` varchar(26) NOT NULL,
  `dataset_id` varchar(26) NOT NULL,
  `position` int NOT NULL,
  `query` mediumtext NOT NULL,
  `expected_answer` mediumtext,
  `expected_tool_trace` json,
  `tags` json NOT NULL DEFAULT (JSON_ARRAY()),
  `source_session_id` varchar(26),
  `created_at` datetime(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
  `updated_at` datetime(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
  CONSTRAINT `ma_eval_dataset_items_id` PRIMARY KEY (`id`),
  CONSTRAINT `ma_eval_dataset_items_dataset_fk` FOREIGN KEY (`dataset_id`) REFERENCES `ma_eval_datasets` (`id`) ON DELETE CASCADE,
  UNIQUE INDEX `ma_eval_dataset_items_dataset_position_uq` (`dataset_id`, `position`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `ma_eval_rubrics` (
  `id` varchar(26) NOT NULL,
  `tenant_id` varchar(26) NOT NULL,
  `name` varchar(128) NOT NULL,
  `description` varchar(1024),
  `version` int NOT NULL DEFAULT 1,
  `content` json NOT NULL,
  `content_hash` varchar(80) NOT NULL,
  `created_by` varchar(26),
  `created_at` datetime(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
  `updated_at` datetime(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
  CONSTRAINT `ma_eval_rubrics_id` PRIMARY KEY (`id`),
  CONSTRAINT `ma_eval_rubrics_tenant_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`) ON DELETE CASCADE,
  UNIQUE INDEX `ma_eval_rubrics_tenant_name_uq` (`tenant_id`, `name`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `ma_eval_runs` (
  `id` varchar(26) NOT NULL,
  `tenant_id` varchar(26) NOT NULL,
  `kind` varchar(16) NOT NULL,
  `status` varchar(16) NOT NULL DEFAULT 'queued',
  `agent_id` varchar(26) NOT NULL,
  `agent_version` int NOT NULL,
  `environment_id` varchar(26),
  `dataset_id` varchar(26),
  `dataset_name` varchar(128) NOT NULL,
  `dataset_hash` varchar(80) NOT NULL,
  `rubric_id` varchar(26),
  `rubric_name` varchar(128) NOT NULL,
  `rubric_version` int NOT NULL,
  `rubric_hash` varchar(80) NOT NULL,
  `base_run_id` varchar(26),
  `config` json NOT NULL,
  `progress` json NOT NULL DEFAULT (JSON_OBJECT()),
  `summary` json NOT NULL DEFAULT (JSON_OBJECT()),
  `error` text,
  `created_by` varchar(26),
  `claimed_by` varchar(64),
  `heartbeat_at` datetime(6),
  `started_at` datetime(6),
  `finished_at` datetime(6),
  `created_at` datetime(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
  `updated_at` datetime(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
  CONSTRAINT `ma_eval_runs_id` PRIMARY KEY (`id`),
  CONSTRAINT `ma_eval_runs_tenant_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`) ON DELETE CASCADE,
  INDEX `ma_eval_runs_tenant_created_idx` (`tenant_id`, `created_at`),
  INDEX `ma_eval_runs_status_created_idx` (`status`, `created_at`),
  INDEX `ma_eval_runs_tenant_agent_idx` (`tenant_id`, `agent_id`, `created_at`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `ma_eval_results` (
  `id` varchar(26) NOT NULL,
  `tenant_id` varchar(26) NOT NULL,
  `run_id` varchar(26) NOT NULL,
  `item_id` varchar(26) NOT NULL,
  `position` int NOT NULL,
  `status` varchar(16) NOT NULL,
  `score_milli` int,
  `session_id` varchar(26),
  `answer` mediumtext,
  `tool_names` json NOT NULL DEFAULT (JSON_ARRAY()),
  `stop_reason` varchar(32),
  `rule_results` json NOT NULL DEFAULT (JSON_ARRAY()),
  `judge` json,
  `usage` json NOT NULL DEFAULT (JSON_OBJECT()),
  `duration_ms` int NOT NULL DEFAULT 0,
  `error` text,
  `created_at` datetime(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
  CONSTRAINT `ma_eval_results_id` PRIMARY KEY (`id`),
  CONSTRAINT `ma_eval_results_run_fk` FOREIGN KEY (`run_id`) REFERENCES `ma_eval_runs` (`id`) ON DELETE CASCADE,
  UNIQUE INDEX `ma_eval_results_run_item_uq` (`run_id`, `item_id`),
  INDEX `ma_eval_results_run_position_idx` (`run_id`, `position`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `ma_eval_candidates` (
  `id` varchar(26) NOT NULL,
  `tenant_id` varchar(26) NOT NULL,
  `run_id` varchar(26) NOT NULL,
  `base_run_id` varchar(26) NOT NULL,
  `agent_id` varchar(26) NOT NULL,
  `base_version` int NOT NULL,
  `manifest` json NOT NULL,
  `manifest_hash` varchar(80) NOT NULL,
  `diff` json NOT NULL DEFAULT (JSON_OBJECT()),
  `rationale` text,
  `status` varchar(16) NOT NULL DEFAULT 'proposed',
  `applied_version` int,
  `decided_by` varchar(26),
  `decided_at` datetime(6),
  `created_at` datetime(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
  `updated_at` datetime(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
  CONSTRAINT `ma_eval_candidates_id` PRIMARY KEY (`id`),
  CONSTRAINT `ma_eval_candidates_run_fk` FOREIGN KEY (`run_id`) REFERENCES `ma_eval_runs` (`id`) ON DELETE CASCADE,
  INDEX `ma_eval_candidates_tenant_agent_idx` (`tenant_id`, `agent_id`, `created_at`)
);
