CREATE TABLE IF NOT EXISTS `chat_share_snapshots` (
  `token` varchar(64) NOT NULL,
  `session_id` varchar(26) NOT NULL,
  `tenant_id` varchar(26) NOT NULL,
  `user_id` varchar(26) NOT NULL,
  `title` varchar(160) NOT NULL,
  `messages` json NOT NULL,
  `created_at` datetime(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
  `revoked_at` datetime(6),
  CONSTRAINT `chat_share_snapshots_token` PRIMARY KEY(`token`)
);
--> statement-breakpoint
CREATE INDEX `chat_share_snapshots_session_idx`
  ON `chat_share_snapshots` (`tenant_id`, `user_id`, `session_id`);
--> statement-breakpoint
CREATE INDEX `chat_share_snapshots_created_idx`
  ON `chat_share_snapshots` (`created_at`);
