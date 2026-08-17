ALTER TABLE `portal_request_logs` ADD COLUMN `mode` varchar(32);
--> statement-breakpoint
ALTER TABLE `portal_request_logs` ADD COLUMN `run_id` varchar(64);
--> statement-breakpoint
CREATE INDEX `portal_request_logs_tenant_mode_time_idx` ON `portal_request_logs` (`tenant_id`, `mode`, `log_time`);
--> statement-breakpoint
CREATE INDEX `portal_request_logs_tenant_run_idx` ON `portal_request_logs` (`tenant_id`, `run_id`);
