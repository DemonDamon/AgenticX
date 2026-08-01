CREATE TABLE `enterprise_chat_attachments` (
  `id` varchar(26) NOT NULL,
  `tenant_id` varchar(26) NOT NULL,
  `user_id` varchar(26) NOT NULL,
  `session_id` varchar(26),
  `file_name` text NOT NULL,
  `mime_type` varchar(128) NOT NULL,
  `byte_size` bigint NOT NULL,
  `kind` varchar(32) NOT NULL DEFAULT 'document',
  `storage_driver` varchar(16) NOT NULL DEFAULT 'fs',
  `storage_key` text NOT NULL,
  `checksum` varchar(64) NOT NULL,
  `created_at` datetime(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
  `expires_at` datetime(6),
  CONSTRAINT `enterprise_chat_attachments_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `enterprise_chat_attachments_owner_idx`
  ON `enterprise_chat_attachments` (`tenant_id`, `user_id`, `created_at`);
--> statement-breakpoint
CREATE INDEX `enterprise_chat_attachments_session_idx`
  ON `enterprise_chat_attachments` (`tenant_id`, `session_id`);
