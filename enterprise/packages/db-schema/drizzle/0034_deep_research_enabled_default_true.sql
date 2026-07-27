-- Product default: deep research on; align existing tenants that still have the old false default.
ALTER TABLE "enterprise_runtime_web_search"
  ALTER COLUMN "deep_research_enabled" SET DEFAULT true;

UPDATE "enterprise_runtime_web_search"
SET "deep_research_enabled" = true
WHERE "deep_research_enabled" = false;
