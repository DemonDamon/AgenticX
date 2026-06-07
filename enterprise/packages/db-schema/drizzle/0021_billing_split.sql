CREATE TABLE IF NOT EXISTS "billing_split_rules" (
	"id" varchar(26) PRIMARY KEY NOT NULL,
	"tenant_id" varchar(26) NOT NULL,
	"name" varchar(128) NOT NULL,
	"effective_start" timestamp with time zone NOT NULL,
	"effective_end" timestamp with time zone,
	"split_mode" varchar(32) DEFAULT 'fixed_ratio' NOT NULL,
	"participants" jsonb NOT NULL,
	"billing_items" jsonb,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "billing_split_rules_tenant_effective_idx" ON "billing_split_rules" ("tenant_id","effective_start","effective_end");--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "billing_split_ledger" (
	"id" varchar(26) PRIMARY KEY NOT NULL,
	"tenant_id" varchar(26) NOT NULL,
	"usage_record_id" varchar(26) NOT NULL,
	"rule_id" varchar(26) NOT NULL,
	"rule_version" varchar(64) NOT NULL,
	"participant_id" varchar(64) NOT NULL,
	"participant_label" varchar(128),
	"amount_micro_usd" bigint NOT NULL,
	"original_cost_micro_usd" bigint NOT NULL,
	"time_bucket" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "billing_split_ledger_usage_participant_rule_idx" ON "billing_split_ledger" ("usage_record_id","participant_id","rule_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "billing_split_ledger_tenant_time_idx" ON "billing_split_ledger" ("tenant_id","time_bucket");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "billing_split_ledger_tenant_participant_idx" ON "billing_split_ledger" ("tenant_id","participant_id");--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "billing_settlement_webhook_config" (
	"tenant_id" varchar(26) PRIMARY KEY NOT NULL,
	"webhook_url" text,
	"enabled" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "billing_settlement_webhook_events" (
	"id" varchar(26) PRIMARY KEY NOT NULL,
	"tenant_id" varchar(26) NOT NULL,
	"payload" jsonb NOT NULL,
	"status" varchar(32) NOT NULL,
	"response_status" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "billing_settlement_webhook_events_tenant_idx" ON "billing_settlement_webhook_events" ("tenant_id","created_at");
