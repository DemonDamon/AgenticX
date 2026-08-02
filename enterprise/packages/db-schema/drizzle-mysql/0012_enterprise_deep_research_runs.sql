CREATE TABLE `enterprise_deep_research_runs` (
  `run_id` varchar(26) NOT NULL,
  `tenant_id` varchar(26) NOT NULL,
  `user_id` varchar(26) NOT NULL,
  `session_id` varchar(26) NOT NULL,
  `status` varchar(32) NOT NULL DEFAULT 'running',
  `phase` varchar(32) NOT NULL DEFAULT 'recon',
  `topic` text NOT NULL,
  `events` json NOT NULL,
  `report_markdown` text NOT NULL,
  `citations` json NOT NULL,
  `error_message` text,
  `event_seq` int NOT NULL DEFAULT 0,
  `created_at` datetime(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
  `updated_at` datetime(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
  CONSTRAINT `enterprise_deep_research_runs_run_id` PRIMARY KEY(`run_id`)
);
--> statement-breakpoint
CREATE INDEX `enterprise_deep_research_runs_session_idx`
  ON `enterprise_deep_research_runs` (`tenant_id`, `session_id`, `created_at`);
--> statement-breakpoint
CREATE INDEX `enterprise_deep_research_runs_status_idx`
  ON `enterprise_deep_research_runs` (`tenant_id`, `status`, `updated_at`);
