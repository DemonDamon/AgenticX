ALTER TABLE "usage_records" ADD COLUMN IF NOT EXISTS "api_token_id" bigint;
CREATE INDEX IF NOT EXISTS "usage_records_api_token_idx" ON "usage_records" ("tenant_id", "api_token_id");
