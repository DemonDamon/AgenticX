CREATE TABLE `portal_request_logs` (
  `id` varchar(26) NOT NULL,
  `tenant_id` varchar(64) NOT NULL,
  `log_time` datetime(6) NOT NULL,
  `level` varchar(16) NOT NULL,
  `event` varchar(128) NOT NULL,
  `trace_id` varchar(128),
  `user_id` varchar(128),
  `session_id` varchar(128),
  `route` varchar(128),
  `status` int,
  `duration_ms` int,
  `error_name` varchar(128),
  `error_message` text,
  `error_stack` text,
  `fields` json,
  `created_at` datetime(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
  `updated_at` datetime(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
  CONSTRAINT `portal_request_logs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `portal_request_logs_tenant_trace_idx`
  ON `portal_request_logs` (`tenant_id`, `trace_id`);
--> statement-breakpoint
CREATE INDEX `portal_request_logs_tenant_time_idx`
  ON `portal_request_logs` (`tenant_id`, `log_time`);
--> statement-breakpoint
CREATE INDEX `portal_request_logs_tenant_user_time_idx`
  ON `portal_request_logs` (`tenant_id`, `user_id`, `log_time`);
--> statement-breakpoint
CREATE INDEX `portal_request_logs_tenant_level_time_idx`
  ON `portal_request_logs` (`tenant_id`, `level`, `log_time`);
