-- 企业案例库（MySQL）。TEXT 默认值写成表达式，避免 8.0 ERROR 1101。
-- 不写 DEFAULT CHARSET/COLLATE，避免和外键引用的 tenants.id 排序规则不一致。

CREATE TABLE IF NOT EXISTS `enterprise_cases` (
  `id` varchar(26) NOT NULL,
  `tenant_id` varchar(26) NOT NULL,
  `title` varchar(128) NOT NULL,
  `summary` text NOT NULL DEFAULT (''),
  `source_repo` varchar(512) NOT NULL DEFAULT '',
  `status` varchar(16) NOT NULL DEFAULT 'submitted',
  `submitter_user_id` varchar(26) NOT NULL,
  `manifest` json NOT NULL DEFAULT (JSON_OBJECT()),
  `package_path` text NOT NULL DEFAULT (''),
  `created_at` datetime(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
  `updated_at` datetime(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
  CONSTRAINT `enterprise_cases_id` PRIMARY KEY(`id`),
  CONSTRAINT `enterprise_cases_tenant_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE CASCADE,
  INDEX `enterprise_cases_tenant_status_idx` (`tenant_id`,`status`)
);
