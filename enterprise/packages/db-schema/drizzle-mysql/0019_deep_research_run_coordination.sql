ALTER TABLE `enterprise_deep_research_runs`
  ADD COLUMN `revision` int NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE `enterprise_deep_research_runs`
  ADD COLUMN `clarify_resume` json NULL;
--> statement-breakpoint
ALTER TABLE `enterprise_deep_research_runs`
  ADD COLUMN `clarify_expires_at` datetime(6) NULL;
