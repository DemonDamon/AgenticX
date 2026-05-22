ALTER TABLE "gateway_audit_events" ADD COLUMN IF NOT EXISTS "channel_id" varchar(26);
ALTER TABLE "gateway_audit_events" ADD COLUMN IF NOT EXISTS "channel_key_ref" varchar(128);
ALTER TABLE "gateway_audit_events" ADD COLUMN IF NOT EXISTS "api_token_id" bigint;
