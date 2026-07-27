ALTER TABLE `enterprise_runtime_web_search` ALTER COLUMN `max_results` SET DEFAULT 50;--> statement-breakpoint
UPDATE `enterprise_runtime_web_search` SET `max_results` = 50 WHERE `max_results` = 5;
