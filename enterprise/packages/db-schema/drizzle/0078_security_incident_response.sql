-- SP5 incident-response-loop: security_incidents / security_incident_actions / enterprise_runtime_session_revocation
CREATE TABLE IF NOT EXISTS "security_incidents" (
  "id" varchar(26) PRIMARY KEY NOT NULL,
  "tenant_id" varchar(26) NOT NULL,
  "title" varchar(256) NOT NULL,
  "source" varchar(32) DEFAULT 'manual' NOT NULL,
  "severity" varchar(16) DEFAULT 'high' NOT NULL,
  "status" varchar(16) DEFAULT 'open' NOT NULL,
  "trace_id" varchar(128),
  "session_id" varchar(160),
  "user_id" varchar(128),
  "model" varchar(128),
  "summary" text,
  "created_by" varchar(128),
  "handled_at" timestamp with time zone,
  "resolved_at" timestamp with time zone,
  "resolution_note" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "security_incidents_tenant_status_idx"
  ON "security_incidents" ("tenant_id", "status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "security_incidents_tenant_trace_idx"
  ON "security_incidents" ("tenant_id", "trace_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "security_incident_actions" (
  "id" varchar(26) PRIMARY KEY NOT NULL,
  "incident_id" varchar(26) NOT NULL,
  "tenant_id" varchar(26) NOT NULL,
  "action_type" varchar(32) NOT NULL,
  "target_type" varchar(16) NOT NULL,
  "target_id" varchar(160),
  "actor_user_id" varchar(128),
  "detail" text,
  "outcome" varchar(16) NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "security_incident_actions_incident_idx"
  ON "security_incident_actions" ("incident_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "enterprise_runtime_session_revocation" (
  "tenant_id" varchar(26) PRIMARY KEY NOT NULL,
  "version" numeric(20, 0) DEFAULT '0' NOT NULL,
  "revoked_session_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
