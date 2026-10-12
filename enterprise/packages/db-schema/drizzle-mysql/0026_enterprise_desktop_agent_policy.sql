-- 租户级本机智能体动作策略。
CREATE TABLE IF NOT EXISTS `enterprise_desktop_agent_policies` (
  `tenant_id` varchar(26) NOT NULL,
  `config` json NOT NULL,
  `updated_at` datetime(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
  PRIMARY KEY (`tenant_id`)
);
