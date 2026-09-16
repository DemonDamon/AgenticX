-- 多真人协作房间：房间 / 成员 / 消息。不写 DEFAULT CHARSET/COLLATE。

CREATE TABLE IF NOT EXISTS `enterprise_collab_rooms` (
  `id` varchar(26) NOT NULL,
  `tenant_id` varchar(26) NOT NULL,
  `title` varchar(160) NOT NULL,
  `created_by` varchar(26) NOT NULL,
  `archived_at` datetime(6),
  `created_at` datetime(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
  `updated_at` datetime(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
  CONSTRAINT `enterprise_collab_rooms_id` PRIMARY KEY (`id`),
  CONSTRAINT `enterprise_collab_rooms_tenant_fk` FOREIGN KEY (`tenant_id`)
    REFERENCES `tenants` (`id`) ON DELETE CASCADE,
  CONSTRAINT `enterprise_collab_rooms_created_by_fk` FOREIGN KEY (`created_by`)
    REFERENCES `users` (`id`) ON DELETE RESTRICT,
  INDEX `enterprise_collab_rooms_tenant_updated_idx` (`tenant_id`, `updated_at`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `enterprise_collab_room_members` (
  `id` varchar(26) NOT NULL,
  `room_id` varchar(26) NOT NULL,
  `tenant_id` varchar(26) NOT NULL,
  `member_type` varchar(16) NOT NULL,
  `member_id` varchar(64) NOT NULL,
  `display_name` varchar(64) NOT NULL,
  `room_role` varchar(16) NOT NULL DEFAULT 'member',
  `joined_at` datetime(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
  `left_at` datetime(6),
  `created_at` datetime(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
  `updated_at` datetime(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
  CONSTRAINT `enterprise_collab_room_members_id` PRIMARY KEY (`id`),
  CONSTRAINT `enterprise_collab_room_members_room_fk` FOREIGN KEY (`room_id`)
    REFERENCES `enterprise_collab_rooms` (`id`) ON DELETE CASCADE,
  CONSTRAINT `enterprise_collab_room_members_room_member_uq` UNIQUE (`room_id`, `member_type`, `member_id`),
  INDEX `enterprise_collab_room_members_lookup_idx` (`tenant_id`, `member_id`, `left_at`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `enterprise_collab_room_messages` (
  `id` varchar(26) NOT NULL,
  `room_id` varchar(26) NOT NULL,
  `tenant_id` varchar(26) NOT NULL,
  `seq` bigint NOT NULL,
  `sender_type` varchar(16) NOT NULL,
  `sender_id` varchar(64) NOT NULL,
  `sender_name` varchar(64) NOT NULL,
  `content` text NOT NULL,
  `model` varchar(160),
  `metadata` json,
  `created_at` datetime(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
  `updated_at` datetime(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
  CONSTRAINT `enterprise_collab_room_messages_id` PRIMARY KEY (`id`),
  CONSTRAINT `enterprise_collab_room_messages_room_fk` FOREIGN KEY (`room_id`)
    REFERENCES `enterprise_collab_rooms` (`id`) ON DELETE CASCADE,
  CONSTRAINT `enterprise_collab_room_messages_room_seq_uq` UNIQUE (`room_id`, `seq`),
  INDEX `enterprise_collab_room_messages_room_created_idx` (`room_id`, `created_at`)
);
