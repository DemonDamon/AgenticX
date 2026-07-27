ALTER TABLE "enterprise_runtime_web_search"
  ADD COLUMN IF NOT EXISTS "deep_research_enabled" boolean NOT NULL DEFAULT false;
