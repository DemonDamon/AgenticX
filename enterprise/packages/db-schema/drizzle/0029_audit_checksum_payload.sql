ALTER TABLE "gateway_audit_events" ADD COLUMN IF NOT EXISTS "checksum_version" varchar(16) NOT NULL DEFAULT 'v1';--> statement-breakpoint
ALTER TABLE "gateway_audit_events" ADD COLUMN IF NOT EXISTS "checksum_payload" text;
