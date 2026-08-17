ALTER TABLE "portal_request_logs" ADD COLUMN IF NOT EXISTS "mode" varchar(32);
--> statement-breakpoint
ALTER TABLE "portal_request_logs" ADD COLUMN IF NOT EXISTS "run_id" varchar(64);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "portal_request_logs_tenant_mode_time_idx"
  ON "portal_request_logs" ("tenant_id", "mode", "log_time");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "portal_request_logs_tenant_run_idx"
  ON "portal_request_logs" ("tenant_id", "run_id");
