ALTER TABLE `enterprise_chat_artifacts`
  MODIFY COLUMN `content` mediumtext NOT NULL;
--> statement-breakpoint
ALTER TABLE `enterprise_deep_research_runs`
  MODIFY COLUMN `report_markdown` mediumtext NOT NULL;
