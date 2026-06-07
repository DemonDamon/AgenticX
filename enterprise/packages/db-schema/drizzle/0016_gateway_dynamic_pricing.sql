CREATE TABLE IF NOT EXISTS "enterprise_runtime_pricing" (
	"tenant_id" varchar(26) PRIMARY KEY NOT NULL,
	"config" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "usage_records" ADD COLUMN IF NOT EXISTS "pricing_version" varchar(128);
