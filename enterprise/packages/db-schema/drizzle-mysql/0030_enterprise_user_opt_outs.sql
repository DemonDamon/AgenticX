-- 个人关闭记录合并成一张表：能力（mcp:/skill:）与模型（model:）同一种事，同一处存。

CREATE TABLE IF NOT EXISTS `enterprise_user_opt_outs` (
  `tenant_id` varchar(26) NOT NULL,
  `user_id` varchar(64) NOT NULL,
  `subject` varchar(256) NOT NULL,
  `created_at` datetime(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
  `updated_at` datetime(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
  PRIMARY KEY (`tenant_id`, `user_id`, `subject`),
  KEY `enterprise_user_opt_outs_tenant_user_idx` (`tenant_id`, `user_id`),
  CONSTRAINT `enterprise_user_opt_outs_tenant_fk` FOREIGN KEY (`tenant_id`)
    REFERENCES `tenants` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT IGNORE INTO `enterprise_user_opt_outs` (`tenant_id`, `user_id`, `subject`)
SELECT `tenant_id`, `user_id`, `capability_id` FROM `enterprise_capability_opt_outs`;

DROP TABLE IF EXISTS `enterprise_capability_opt_outs`;
