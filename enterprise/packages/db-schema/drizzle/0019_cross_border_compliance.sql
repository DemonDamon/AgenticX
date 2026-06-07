ALTER TABLE "gateway_channels" ADD COLUMN IF NOT EXISTS "region" varchar(16);--> statement-breakpoint
ALTER TABLE "gateway_audit_events" ADD COLUMN IF NOT EXISTS "src_region" varchar(16);--> statement-breakpoint
ALTER TABLE "gateway_audit_events" ADD COLUMN IF NOT EXISTS "dst_region" varchar(16);--> statement-breakpoint
ALTER TABLE "gateway_audit_events" ADD COLUMN IF NOT EXISTS "cross_border" boolean;--> statement-breakpoint
ALTER TABLE "gateway_audit_events" ADD COLUMN IF NOT EXISTS "residency_rule" varchar(64);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "enterprise_runtime_compliance" (
	"tenant_id" varchar(26) PRIMARY KEY NOT NULL,
	"data_residency" varchar(16),
	"cross_border_action" varchar(32) DEFAULT 'allow' NOT NULL,
	"audit_retention_years" integer DEFAULT 6 NOT NULL,
	"append_only" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "gateway_audit_events_cross_border_idx" ON "gateway_audit_events" ("tenant_id","cross_border","event_time");
