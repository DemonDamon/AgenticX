ALTER TABLE `enterprise_agents` ADD COLUMN `lifecycle` varchar(16) NOT NULL DEFAULT 'published';
--> statement-breakpoint
ALTER TABLE `enterprise_agents` ADD COLUMN `origin` varchar(16) NOT NULL DEFAULT 'enterprise';
--> statement-breakpoint
ALTER TABLE `enterprise_agents` ADD COLUMN `owner_user_id` varchar(26) NULL;
--> statement-breakpoint
ALTER TABLE `enterprise_agents` ADD COLUMN `local_avatar_id` varchar(64) NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX `enterprise_agents_owner_avatar_uq` ON `enterprise_agents` (`tenant_id`, `owner_user_id`, `local_avatar_id`);
