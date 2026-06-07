CREATE TABLE IF NOT EXISTS "enterprise_runtime_budgets" (
	"tenant_id" varchar(26) PRIMARY KEY NOT NULL,
	"config" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "gateway_budget_alerts" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"tenant_id" varchar(26) NOT NULL,
	"dept_id" varchar(64),
	"user_id" varchar(64),
	"dimension" varchar(16) NOT NULL,
	"dimension_key" varchar(128) NOT NULL,
	"period" varchar(16) NOT NULL,
	"unit" varchar(16) NOT NULL,
	"alert_type" varchar(16) NOT NULL,
	"used_value" numeric(18, 8) DEFAULT '0' NOT NULL,
	"limit_value" numeric(18, 8) DEFAULT '0' NOT NULL,
	"warn_threshold_pct" numeric(5, 2) DEFAULT '0' NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "gateway_budget_alerts_tenant_time_idx" ON "gateway_budget_alerts" ("tenant_id", "created_at");
