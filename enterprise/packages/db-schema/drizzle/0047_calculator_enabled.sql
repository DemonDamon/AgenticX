ALTER TABLE "enterprise_runtime_web_search"
  ADD COLUMN IF NOT EXISTS "calculator_enabled" boolean DEFAULT true NOT NULL;
