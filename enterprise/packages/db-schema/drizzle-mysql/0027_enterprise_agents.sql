-- 企业 Agent 注册表（MySQL）。text[] 在此方言下落为 json，写法同 enterprise_skills.required_capabilities。
-- TEXT 默认值必须写成表达式 DEFAULT ('')，否则 8.0 报 ERROR 1101。
-- model 与门户模型选择器同一格式：<providerId>/<modelName>。
-- 不写 DEFAULT CHARSET/COLLATE：写了会覆盖库默认，和 tenants.id 对不上就是外键 errno 3780。

CREATE TABLE IF NOT EXISTS `enterprise_agents` (
  `id` varchar(26) NOT NULL,
  `tenant_id` varchar(26) NOT NULL,
  `slug` varchar(64) NOT NULL,
  `display_name` varchar(64) NOT NULL,
  `description` text,
  `system_prompt` text NOT NULL DEFAULT (''),
  `model` varchar(160) NOT NULL,
  `runtime` varchar(24) NOT NULL DEFAULT 'cloud',
  `capability_ids` json NOT NULL DEFAULT (JSON_ARRAY()),
  `assignment_keys` json NOT NULL DEFAULT (JSON_ARRAY('all')),
  `status` varchar(16) NOT NULL DEFAULT 'active',
  `metadata` json NOT NULL DEFAULT (JSON_OBJECT()),
  `created_at` datetime(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
  `updated_at` datetime(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
  CONSTRAINT `enterprise_agents_id` PRIMARY KEY(`id`),
  CONSTRAINT `enterprise_agents_tenant_slug_uq` UNIQUE(`tenant_id`,`slug`),
  CONSTRAINT `enterprise_agents_tenant_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE CASCADE,
  INDEX `enterprise_agents_tenant_status_idx` (`tenant_id`,`status`)
);
