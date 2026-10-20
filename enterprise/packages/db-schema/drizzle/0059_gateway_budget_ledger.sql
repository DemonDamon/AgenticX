CREATE TABLE IF NOT EXISTS "gateway_budget_usage" (
  "tenant_id" varchar(26) NOT NULL,
  "dimension" varchar(16) NOT NULL,
  "dimension_key" varchar(128) NOT NULL,
  "period" varchar(16) NOT NULL,
  "unit" varchar(16) NOT NULL,
  "used_value" numeric(38,18) DEFAULT 0 NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "gateway_budget_usage_pk" PRIMARY KEY ("tenant_id","dimension","dimension_key","period","unit")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "gateway_budget_reservations" (
  "receipt_id" varchar(32) PRIMARY KEY NOT NULL,
  "tenant_id" varchar(26) NOT NULL,
  "state" varchar(16) NOT NULL,
  "lines_json" text NOT NULL,
  "actual_tokens" bigint,
  "actual_cost_usd" numeric(38,18),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
