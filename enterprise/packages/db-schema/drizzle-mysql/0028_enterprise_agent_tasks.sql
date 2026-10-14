-- 桌面执行任务队列（MySQL）。
-- worker_keys / input 是 JSON：默认值必须写成 DEFAULT (JSON_ARRAY()) 或 DEFAULT (JSON_OBJECT())。
-- 不写 DEFAULT CHARSET/COLLATE，避免和外键列排序规则不一致（errno 3780）。

ALTER TABLE `enterprise_agents` ADD COLUMN `worker_keys` json NOT NULL DEFAULT (JSON_ARRAY());
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `enterprise_agent_workers` (
  `id` varchar(26) NOT NULL,
  `tenant_id` varchar(26) NOT NULL,
  `agent_id` varchar(26) NOT NULL,
  `user_id` varchar(26) NOT NULL,
  `device_id` varchar(64) NOT NULL,
  `device_name` varchar(128) NOT NULL,
  `last_heartbeat_at` datetime(6) NOT NULL,
  `created_at` datetime(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
  `updated_at` datetime(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
  CONSTRAINT `enterprise_agent_workers_id` PRIMARY KEY (`id`),
  CONSTRAINT `enterprise_agent_workers_agent_fk` FOREIGN KEY (`agent_id`)
    REFERENCES `enterprise_agents` (`id`) ON DELETE CASCADE,
  CONSTRAINT `enterprise_agent_workers_user_fk` FOREIGN KEY (`user_id`)
    REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `enterprise_agent_workers_agent_user_device_uq` UNIQUE (`agent_id`, `user_id`, `device_id`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `enterprise_agent_tasks` (
  `id` varchar(26) NOT NULL,
  `tenant_id` varchar(26) NOT NULL,
  `agent_id` varchar(26) NOT NULL,
  `room_id` varchar(26) NOT NULL,
  `trigger_message_id` varchar(26) NOT NULL,
  `requested_by` varchar(26) NOT NULL,
  `status` varchar(16) NOT NULL DEFAULT 'queued',
  `input` json NOT NULL,
  `attempts` int NOT NULL DEFAULT 0,
  `claimed_by_user_id` varchar(26),
  `claimed_by_device` varchar(64),
  `claimed_at` datetime(6),
  `lease_expires_at` datetime(6),
  `completed_at` datetime(6),
  `result_message_id` varchar(26),
  `error` text,
  `created_at` datetime(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
  `updated_at` datetime(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
  CONSTRAINT `enterprise_agent_tasks_id` PRIMARY KEY (`id`),
  CONSTRAINT `enterprise_agent_tasks_agent_fk` FOREIGN KEY (`agent_id`)
    REFERENCES `enterprise_agents` (`id`) ON DELETE CASCADE,
  CONSTRAINT `enterprise_agent_tasks_room_fk` FOREIGN KEY (`room_id`)
    REFERENCES `enterprise_collab_rooms` (`id`) ON DELETE CASCADE,
  INDEX `enterprise_agent_tasks_queue_idx` (`tenant_id`, `agent_id`, `status`, `created_at`)
);
