ALTER TABLE "enterprise_runtime_web_search"
  ADD COLUMN IF NOT EXISTS "max_search_calls" integer DEFAULT 3 NOT NULL;
