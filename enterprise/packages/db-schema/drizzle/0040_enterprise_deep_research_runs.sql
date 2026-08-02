CREATE TABLE IF NOT EXISTS "enterprise_deep_research_runs" (
  "run_id" varchar(26) PRIMARY KEY NOT NULL,
  "tenant_id" varchar(26) NOT NULL,
  "user_id" varchar(26) NOT NULL,
  "session_id" varchar(26) NOT NULL,
  "status" varchar(32) DEFAULT 'running' NOT NULL,
  "phase" varchar(32) DEFAULT 'recon' NOT NULL,
  "topic" text NOT NULL,
  "events" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "report_markdown" text DEFAULT '' NOT NULL,
  "citations" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "error_message" text,
  "event_seq" integer DEFAULT 0 NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "enterprise_deep_research_runs_session_idx"
  ON "enterprise_deep_research_runs" ("tenant_id", "session_id", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "enterprise_deep_research_runs_status_idx"
  ON "enterprise_deep_research_runs" ("tenant_id", "status", "updated_at");
