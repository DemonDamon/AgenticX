-- Webhook 端点描述与自动停用。时间列与 ma_webhooks 既有 datetime(6) 列同型。
ALTER TABLE `ma_webhooks` ADD COLUMN `description` varchar(2048) NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE `ma_webhooks` ADD COLUMN `disabled_reason` varchar(64) NULL;
--> statement-breakpoint
ALTER TABLE `ma_webhooks` ADD COLUMN `disabled_at` datetime(6) NULL;
--> statement-breakpoint
ALTER TABLE `ma_webhooks` ADD COLUMN `failure_reset_at` datetime(6) NULL;
