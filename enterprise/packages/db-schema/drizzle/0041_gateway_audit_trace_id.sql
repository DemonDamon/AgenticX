ALTER TABLE "gateway_audit_events" ADD COLUMN IF NOT EXISTS "trace_id" varchar(128);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "gateway_audit_events_tenant_trace_idx"
  ON "gateway_audit_events" ("tenant_id", "trace_id");
