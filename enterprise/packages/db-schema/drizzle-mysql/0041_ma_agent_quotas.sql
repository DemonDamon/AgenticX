-- 托管智能体「用户 × 智能体」token 配额（MySQL）。
CREATE TABLE IF NOT EXISTS `ma_agent_quotas` (
  `id` varchar(26) NOT NULL,
  `tenant_id` varchar(26) NOT NULL,
  `agent_id` varchar(26) NOT NULL,
  `subject_key` varchar(40) NOT NULL,
  `user_id` varchar(26),
  `daily_tokens` bigint NOT NULL DEFAULT 0,
  `weekly_tokens` bigint NOT NULL DEFAULT 0,
  `monthly_tokens` bigint NOT NULL DEFAULT 0,
  `created_by` varchar(26),
  `created_at` datetime(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
  `updated_at` datetime(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
  CONSTRAINT `ma_agent_quotas_id` PRIMARY KEY (`id`),
  CONSTRAINT `ma_agent_quotas_tenant_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`) ON DELETE CASCADE,
  CONSTRAINT `ma_agent_quotas_agent_fk` FOREIGN KEY (`agent_id`) REFERENCES `enterprise_agents` (`id`) ON DELETE CASCADE,
  UNIQUE INDEX `ma_agent_quotas_subject_uq` (`tenant_id`, `agent_id`, `subject_key`)
);
--> statement-breakpoint
CREATE INDEX `ma_session_usage_quota_idx` ON `ma_session_usage` (`tenant_id`, `agent_id`, `user_id`, `created_at`);
