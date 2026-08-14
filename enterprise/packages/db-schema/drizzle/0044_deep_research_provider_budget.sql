ALTER TABLE "enterprise_runtime_web_search"
  ADD COLUMN IF NOT EXISTS "max_deep_research_provider_calls" integer DEFAULT 24 NOT NULL;
