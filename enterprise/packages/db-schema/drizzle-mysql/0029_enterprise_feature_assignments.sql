-- 功能级分配（联网搜索 / 深度研究）：与可见模型、能力包共用同一套分配键。
-- 没有任何行 = 全员可用；一旦有行，就只有命中的人可用。

CREATE TABLE IF NOT EXISTS `enterprise_feature_assignments` (
  `tenant_id` varchar(26) NOT NULL,
  `feature` varchar(64) NOT NULL,
  `assignment_key` varchar(128) NOT NULL,
  `created_at` datetime(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
  `updated_at` datetime(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
  PRIMARY KEY (`tenant_id`, `feature`, `assignment_key`),
  KEY `enterprise_feature_assignments_tenant_feature_idx` (`tenant_id`, `feature`),
  CONSTRAINT `enterprise_feature_assignments_tenant_fk` FOREIGN KEY (`tenant_id`)
    REFERENCES `tenants` (`id`) ON DELETE CASCADE
);
