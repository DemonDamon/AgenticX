ALTER TABLE "enterprise_deep_research_runs"
  ADD COLUMN IF NOT EXISTS "revision" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "enterprise_deep_research_runs"
  ADD COLUMN IF NOT EXISTS "clarify_resume" jsonb;
--> statement-breakpoint
ALTER TABLE "enterprise_deep_research_runs"
  ADD COLUMN IF NOT EXISTS "clarify_expires_at" timestamptz;
