CREATE TABLE IF NOT EXISTS "desktop_device_auth" (
	"device_id" varchar(36) PRIMARY KEY NOT NULL,
	"tenant_id" varchar(26) NOT NULL,
	"device_secret_hash" varchar(128) NOT NULL,
	"device_name" varchar(128) DEFAULT 'Near Desktop' NOT NULL,
	"status" varchar(16) DEFAULT 'pending' NOT NULL,
	"user_id" varchar(26),
	"dept_id" varchar(26),
	"issued_token_id" bigint,
	"expires_at" timestamp with time zone NOT NULL,
	"approved_at" timestamp with time zone,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "desktop_device_auth_tenant_status_expires_idx" ON "desktop_device_auth" ("tenant_id","status","expires_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "desktop_device_auth_secret_hash_idx" ON "desktop_device_auth" ("device_secret_hash");
