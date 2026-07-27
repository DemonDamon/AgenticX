CREATE TABLE IF NOT EXISTS `enterprise_runtime_web_search` (
  `tenant_id` varchar(26) NOT NULL,
  `enabled` boolean NOT NULL DEFAULT true,
  `provider` varchar(32) NOT NULL DEFAULT 'duckduckgo',
  `api_key_cipher` text NOT NULL,
  `max_results` int NOT NULL DEFAULT 5,
  `updated_at` datetime(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
  PRIMARY KEY (`tenant_id`)
);
