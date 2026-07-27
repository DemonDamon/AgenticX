CREATE TABLE `enterprise_chat_artifacts` (
  `id` varchar(26) NOT NULL,
  `tenant_id` varchar(26) NOT NULL,
  `user_id` varchar(26) NOT NULL,
  `session_id` varchar(26) NOT NULL,
  `run_id` varchar(26) NOT NULL,
  `path` text NOT NULL,
  `title` text NOT NULL,
  `kind` varchar(32) NOT NULL DEFAULT 'other',
  `mime_type` varchar(128) NOT NULL DEFAULT 'text/markdown',
  `content` text NOT NULL,
  `byte_size` int NOT NULL,
  `created_at` datetime(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
  CONSTRAINT `enterprise_chat_artifacts_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `enterprise_chat_artifacts_session_path_uk`
  ON `enterprise_chat_artifacts` (`session_id`, `path`(255));
--> statement-breakpoint
CREATE INDEX `enterprise_chat_artifacts_session_idx`
  ON `enterprise_chat_artifacts` (`tenant_id`, `session_id`, `created_at`);
