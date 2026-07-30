CREATE TABLE `chat_history_operations` (
  `operation_id` varchar(26) NOT NULL,
  `tenant_id` varchar(26) NOT NULL,
  `user_id` varchar(26) NOT NULL,
  `session_id` varchar(26) NOT NULL,
  `payload_hash` varchar(64) NOT NULL,
  `created_at` datetime(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
  CONSTRAINT `chat_history_operations_operation_id` PRIMARY KEY(`operation_id`)
);
--> statement-breakpoint
CREATE INDEX `chat_history_operations_tenant_user_session_idx`
  ON `chat_history_operations` (`tenant_id`, `user_id`, `session_id`);
