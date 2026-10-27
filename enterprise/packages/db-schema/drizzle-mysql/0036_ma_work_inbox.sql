-- ma_work_items 增加 Worker inbox 游标（MySQL）
ALTER TABLE `ma_work_items` ADD COLUMN `inbox_after_seq` bigint NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE `ma_work_items` ADD COLUMN `consumed_through_seq` bigint NULL;
