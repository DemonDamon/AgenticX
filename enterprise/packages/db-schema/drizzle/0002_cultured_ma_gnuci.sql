DROP MATERIALIZED VIEW IF EXISTS "usage_records_daily_mv";
--> statement-breakpoint
ALTER TABLE "usage_records" DROP CONSTRAINT IF EXISTS "usage_records_dept_id_departments_id_fk";
--> statement-breakpoint
ALTER TABLE "usage_records" DROP CONSTRAINT IF EXISTS "usage_records_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "usage_records" ALTER COLUMN "dept_id" SET DATA TYPE varchar(64);
--> statement-breakpoint
ALTER TABLE "usage_records" ALTER COLUMN "user_id" SET DATA TYPE varchar(64);
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