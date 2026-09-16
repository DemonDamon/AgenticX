-- 个人关闭记录：能力与模型同一处存。fresh install 不搬过渡数据。

CREATE TABLE IF NOT EXISTS `enterprise_user_opt_outs` (
  `tenant_id` varchar(26) NOT NULL,
  `user_id` varchar(64) NOT NULL,
  `subject` varchar(256) NOT NULL,
  `created_at` datetime(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
  `updated_at` datetime(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
  CONSTRAINT `enterprise_user_opt_outs_pk` PRIMARY KEY (`tenant_id`, `user_id`, `subject`),
  CONSTRAINT `enterprise_user_opt_outs_tenant_fk` FOREIGN KEY (`tenant_id`)
    REFERENCES `tenants` (`id`) ON DELETE CASCADE,
  INDEX `enterprise_user_opt_outs_tenant_user_idx` (`tenant_id`, `user_id`)
);
