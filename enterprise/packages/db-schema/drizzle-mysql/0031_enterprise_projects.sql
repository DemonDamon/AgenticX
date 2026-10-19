-- 项目协作（MySQL）：项目表、群层级、消息客户端去重。
-- 不写 DEFAULT CHARSET/COLLATE，避免和外键列排序规则不一致。

CREATE TABLE IF NOT EXISTS `enterprise_projects` (
  `id` varchar(26) NOT NULL,
  `tenant_id` varchar(26) NOT NULL,
  `name` varchar(32) NOT NULL,
  `instructions` text,
  `owner_user_id` varchar(26) NOT NULL,
  `dept_id` varchar(26),
  `main_room_id` varchar(26),
  `settings` json,
  `archived_at` datetime(6),
  `created_at` datetime(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
  `updated_at` datetime(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
  CONSTRAINT `enterprise_projects_id` PRIMARY KEY (`id`),
  CONSTRAINT `enterprise_projects_tenant_fk` FOREIGN KEY (`tenant_id`)
    REFERENCES `tenants` (`id`) ON DELETE CASCADE,
  CONSTRAINT `enterprise_projects_owner_fk` FOREIGN KEY (`owner_user_id`)
    REFERENCES `users` (`id`) ON DELETE RESTRICT,
  INDEX `enterprise_projects_tenant_updated_idx` (`tenant_id`, `updated_at`),
  INDEX `enterprise_projects_tenant_dept_idx` (`tenant_id`, `dept_id`)
);
--> statement-breakpoint
ALTER TABLE `enterprise_collab_rooms` ADD COLUMN `project_id` varchar(26) NULL;
--> statement-breakpoint
ALTER TABLE `enterprise_collab_rooms` ADD CONSTRAINT `enterprise_collab_rooms_project_fk` FOREIGN KEY (`project_id`) REFERENCES `enterprise_projects` (`id`) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE `enterprise_collab_rooms` ADD COLUMN `parent_room_id` varchar(26) NULL;
--> statement-breakpoint
ALTER TABLE `enterprise_collab_rooms` ADD COLUMN `room_kind` varchar(16) NOT NULL DEFAULT 'room';
--> statement-breakpoint
ALTER TABLE `enterprise_collab_rooms` ADD INDEX `enterprise_collab_rooms_project_idx` (`project_id`, `room_kind`);
--> statement-breakpoint
ALTER TABLE `enterprise_collab_room_messages` ADD COLUMN `client_msg_id` varchar(64) NULL;
--> statement-breakpoint
ALTER TABLE `enterprise_collab_room_messages` ADD CONSTRAINT `enterprise_collab_room_messages_room_client_uq` UNIQUE (`room_id`, `client_msg_id`);
