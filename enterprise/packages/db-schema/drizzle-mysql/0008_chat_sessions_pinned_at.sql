ALTER TABLE `chat_sessions` ADD COLUMN `pinned_at` datetime(6) NULL;
--> statement-breakpoint
CREATE INDEX `chat_sessions_tenant_user_pinned_idx`
  ON `chat_sessions` (`tenant_id`, `user_id`, `pinned_at`);
