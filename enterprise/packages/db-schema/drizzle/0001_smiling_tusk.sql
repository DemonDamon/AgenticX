CREATE TABLE "usage_records" (
	"id" varchar(26) PRIMARY KEY NOT NULL,
	"tenant_id" varchar(26) NOT NULL,
	"dept_id" varchar(26),
	"user_id" varchar(26),
	"provider" varchar(64) NOT NULL,
	"model" varchar(128) NOT NULL,
	"route" varchar(32) NOT NULL,
	"time_bucket" timestamp with time zone NOT NULL,
	"input_tokens" numeric(20, 0) DEFAULT '0' NOT NULL,
	"output_tokens" numeric(20, 0) DEFAULT '0' NOT NULL,
	"total_tokens" numeric(20, 0) DEFAULT '0' NOT NULL,
	"cost_usd" numeric(18, 8) DEFAULT '0' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "usage_records" ADD CONSTRAINT "usage_records_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_records" ADD CONSTRAINT "usage_records_dept_id_departments_id_fk" FOREIGN KEY ("dept_id") REFERENCES "public"."departments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_records" ADD CONSTRAINT "usage_records_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "usage_records_tenant_time_idx" ON "usage_records" USING btree ("tenant_id","time_bucket");--> statement-breakpoint
CREATE INDEX "usage_records_tenant_dims_idx" ON "usage_records" USING btree ("tenant_id","dept_id","user_id","provider");
--> statement-breakpoint
CREATE MATERIALIZED VIEW "usage_records_daily_mv" AS
SELECT
  tenant_id,
  dept_id,
  user_id,
  provider,
  model,
  date_trunc('day', time_bucket) AS day_bucket,
  sum(input_tokens)::numeric(20,0) AS input_tokens,
  sum(output_tokens)::numeric(20,0) AS output_tokens,
  sum(total_tokens)::numeric(20,0) AS total_tokens,
  sum(cost_usd)::numeric(18,8) AS cost_usd
FROM usage_records
GROUP BY tenant_id, dept_id, user_id, provider, model, date_trunc('day', time_bucket);
--> statement-breakpoint
CREATE INDEX "usage_records_daily_mv_tenant_day_idx" ON "usage_records_daily_mv" USING btree ("tenant_id","day_bucket");