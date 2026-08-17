ALTER TABLE `enterprise_deep_research_runs` ADD COLUMN `trace_id` varchar(128);
--> statement-breakpoint
CREATE INDEX `enterprise_deep_research_runs_trace_idx` ON `enterprise_deep_research_runs` (`tenant_id`, `trace_id`);
