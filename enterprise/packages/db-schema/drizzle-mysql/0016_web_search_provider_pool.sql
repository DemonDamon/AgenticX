ALTER TABLE `enterprise_runtime_web_search`
  ADD COLUMN `providers` json NOT NULL DEFAULT ('[]');
