CREATE TABLE `enterprise_web_search_daily_quota` (
  `tenant_id` varchar(26) NOT NULL,
  `max_provider_calls` int NOT NULL DEFAULT 0,
  `usage_day` varchar(10) NOT NULL DEFAULT '',
  `provider_calls_used` int NOT NULL DEFAULT 0,
  `updated_at` datetime(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
  CONSTRAINT `enterprise_web_search_daily_quota_tenant_id` PRIMARY KEY(`tenant_id`)
);
