ALTER TABLE `users` ADD COLUMN `must_change_password` boolean NOT NULL DEFAULT false;
--> statement-breakpoint
ALTER TABLE `auth_refresh_sessions` ADD COLUMN `must_change_password` boolean NOT NULL DEFAULT false;
