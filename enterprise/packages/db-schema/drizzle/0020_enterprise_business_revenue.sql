CREATE TABLE IF NOT EXISTS "enterprise_business_revenue" (
	"id" varchar(26) PRIMARY KEY NOT NULL,
	"tenant_id" varchar(26) NOT NULL,
	"scenario_label" varchar(128) NOT NULL,
	"period_start" timestamp with time zone NOT NULL,
	"period_end" timestamp with time zone NOT NULL,
	"revenue_usd" numeric(18, 8) NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "enterprise_business_revenue_tenant_period_idx" ON "enterprise_business_revenue" ("tenant_id","period_start","period_end");
