-- Product default: deep research on; align existing tenants that still have the old false default.
ALTER TABLE `enterprise_runtime_web_search`
  MODIFY COLUMN `deep_research_enabled` boolean NOT NULL DEFAULT true;
--> statement-breakpoint
UPDATE `enterprise_runtime_web_search`
SET `deep_research_enabled` = true
WHERE `deep_research_enabled` = false;
