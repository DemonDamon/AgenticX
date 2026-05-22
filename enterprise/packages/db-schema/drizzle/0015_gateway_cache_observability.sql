ALTER TABLE "usage_records" ADD COLUMN IF NOT EXISTS "cached_tokens" numeric(20, 0) DEFAULT '0' NOT NULL;
ALTER TABLE "usage_records" ADD COLUMN IF NOT EXISTS "cache_read_input_tokens" numeric(20, 0) DEFAULT '0' NOT NULL;
ALTER TABLE "usage_records" ADD COLUMN IF NOT EXISTS "cache_creation_input_tokens" numeric(20, 0) DEFAULT '0' NOT NULL;
ALTER TABLE "usage_records" ADD COLUMN IF NOT EXISTS "reasoning_tokens" numeric(20, 0) DEFAULT '0' NOT NULL;
ALTER TABLE "usage_records" ADD COLUMN IF NOT EXISTS "usage_source" varchar(32);

ALTER TABLE "gateway_audit_events" ADD COLUMN IF NOT EXISTS "cache_layer" varchar(16);
ALTER TABLE "gateway_audit_events" ADD COLUMN IF NOT EXISTS "cache_key_hash" varchar(128);
ALTER TABLE "gateway_audit_events" ADD COLUMN IF NOT EXISTS "semantic_similarity" numeric(6, 4);
ALTER TABLE "gateway_audit_events" ADD COLUMN IF NOT EXISTS "latency_ms_upstream" bigint;
