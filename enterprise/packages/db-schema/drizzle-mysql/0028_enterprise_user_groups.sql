-- 用户组提成一等主体：此前只是 enterprise_runtime_token_quotas.config 里的
-- groups[<id>].memberIds，没有表、没有外键，删人无法级联，能力包也无从引用。

CREATE TABLE IF NOT EXISTS `enterprise_user_groups` (
  `id` varchar(26) NOT NULL,
  `tenant_id` varchar(26) NOT NULL,
  `name` varchar(64) NOT NULL,
  `description` text,
  `created_at` datetime(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
  `updated_at` datetime(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
  PRIMARY KEY (`id`),
  UNIQUE KEY `enterprise_user_groups_tenant_name_uq` (`tenant_id`, `name`),
  CONSTRAINT `enterprise_user_groups_tenant_fk` FOREIGN KEY (`tenant_id`)
    REFERENCES `tenants` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `enterprise_user_group_members` (
  `group_id` varchar(26) NOT NULL,
  `user_id` varchar(26) NOT NULL,
  `created_at` datetime(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
  `updated_at` datetime(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
  PRIMARY KEY (`group_id`, `user_id`),
  KEY `enterprise_user_group_members_user_idx` (`user_id`),
  CONSTRAINT `enterprise_user_group_members_group_fk` FOREIGN KEY (`group_id`)
    REFERENCES `enterprise_user_groups` (`id`) ON DELETE CASCADE,
  CONSTRAINT `enterprise_user_group_members_user_fk` FOREIGN KEY (`user_id`)
    REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
