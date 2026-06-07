CREATE TABLE IF NOT EXISTS "enterprise_quota_plans" (
	"id" varchar(26) PRIMARY KEY NOT NULL,
	"tenant_id" varchar(26) NOT NULL,
	"name" text NOT NULL,
	"monthly_tokens" bigint NOT NULL,
	"rpm" integer DEFAULT 0 NOT NULL,
	"tpm" integer DEFAULT 0 NOT NULL,
	"max_concurrency" integer DEFAULT 0 NOT NULL,
	"models" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"period" varchar(8) DEFAULT 'month' NOT NULL,
	"status" varchar(16) DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "enterprise_quota_plans_tenant_status_idx" ON "enterprise_quota_plans" ("tenant_id","status");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "enterprise_quota_plan_assignments" (
	"id" varchar(26) PRIMARY KEY NOT NULL,
	"tenant_id" varchar(26) NOT NULL,
	"plan_id" varchar(26) NOT NULL,
	"scope_type" varchar(16) NOT NULL,
	"scope_id" varchar(128) NOT NULL,
	"period_start" timestamp with time zone NOT NULL,
	"period_end" timestamp with time zone NOT NULL,
	"status" varchar(16) DEFAULT 'active' NOT NULL,
	"pending_plan_id" varchar(26),
	"last_rollover_key" varchar(128),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "enterprise_quota_plan_assign_plan_idx" ON "enterprise_quota_plan_assignments" ("tenant_id","plan_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "enterprise_quota_plan_assign_scope_active_uk" ON "enterprise_quota_plan_assignments" ("tenant_id","scope_type","scope_id") WHERE "status" = 'active';
