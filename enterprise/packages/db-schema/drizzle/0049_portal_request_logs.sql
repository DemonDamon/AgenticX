CREATE TABLE IF NOT EXISTS "portal_request_logs" (
  "id" varchar(26) PRIMARY KEY NOT NULL,
  "tenant_id" varchar(64) NOT NULL,
  "log_time" timestamptz NOT NULL,
  "level" varchar(16) NOT NULL,
  "event" varchar(128) NOT NULL,
  "trace_id" varchar(128),
  "user_id" varchar(128),
  "session_id" varchar(128),
  "route" varchar(128),
  "status" integer,
  "duration_ms" integer,
  "error_name" varchar(128),
  "error_message" text,
  "error_stack" text,
  "fields" jsonb,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "portal_request_logs_tenant_trace_idx"
  ON "portal_request_logs" ("tenant_id", "trace_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "portal_request_logs_tenant_time_idx"
  ON "portal_request_logs" ("tenant_id", "log_time");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "portal_request_logs_tenant_user_time_idx"
  ON "portal_request_logs" ("tenant_id", "user_id", "log_time");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "portal_request_logs_tenant_level_time_idx"
  ON "portal_request_logs" ("tenant_id", "level", "log_time");
