CREATE TABLE IF NOT EXISTS `enterprise_feature_usage_daily` (
  `tenant_id` varchar(26) NOT NULL,
  `feature` varchar(32) NOT NULL,
  `user_id` varchar(64) NOT NULL,
  `dept_id` varchar(64),
  `usage_day` varchar(10) NOT NULL,
  `used` int NOT NULL DEFAULT 0,
  `updated_at` datetime(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
  CONSTRAINT `enterprise_feature_usage_daily_pk` PRIMARY KEY(`tenant_id`,`feature`,`user_id`,`usage_day`),
  INDEX `enterprise_feature_usage_daily_feature_day_idx` (`tenant_id`,`feature`,`usage_day`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `enterprise_feature_usage_shared_daily` (
  `tenant_id` varchar(26) NOT NULL,
  `feature` varchar(32) NOT NULL,
  `scope` varchar(16) NOT NULL,
  `scope_id` varchar(64) NOT NULL,
  `usage_day` varchar(10) NOT NULL,
  `used` int NOT NULL DEFAULT 0,
  `updated_at` datetime(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
  CONSTRAINT `enterprise_feature_usage_shared_daily_pk` PRIMARY KEY(`tenant_id`,`feature`,`scope`,`scope_id`,`usage_day`)
);
