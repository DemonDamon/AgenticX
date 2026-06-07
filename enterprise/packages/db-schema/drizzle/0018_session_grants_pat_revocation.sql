CREATE TABLE IF NOT EXISTS "session_grants" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"tenant_id" varchar(26) NOT NULL,
	"session_id" varchar(128) NOT NULL,
	"scopes" jsonb NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_by" varchar(64),
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "session_grants_tenant_session_idx" ON "session_grants" ("tenant_id", "session_id", "expires_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "enterprise_runtime_pat_revocation" (
	"tenant_id" varchar(26) PRIMARY KEY NOT NULL,
	"version" bigint DEFAULT 0 NOT NULL,
	"revoked_hashes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
