CREATE TABLE IF NOT EXISTS "gateway_quota_pool_usage" (
	"tenant_id" varchar(26) NOT NULL,
	"scope_type" varchar(16) NOT NULL,
	"scope_id" varchar(128) NOT NULL,
	"period" varchar(16) NOT NULL,
	"used_total" bigint DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gateway_quota_pool_usage_pkey" PRIMARY KEY("tenant_id","scope_type","scope_id","period")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "gateway_quota_ledger" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"tenant_id" varchar(26) NOT NULL,
	"scope_type" varchar(16) NOT NULL,
	"scope_id" varchar(128) NOT NULL,
	"period" varchar(16) NOT NULL,
	"event" varchar(16) NOT NULL,
	"delta_tokens" bigint NOT NULL,
	"request_id" varchar(128),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "gateway_quota_ledger_scope_idx" ON "gateway_quota_ledger" ("tenant_id","scope_type","scope_id","period");
