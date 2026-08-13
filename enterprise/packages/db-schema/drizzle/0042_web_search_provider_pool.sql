ALTER TABLE "enterprise_runtime_web_search"
  ADD COLUMN IF NOT EXISTS "providers" jsonb DEFAULT '[]'::jsonb NOT NULL;
