ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "must_change_password" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "auth_refresh_sessions" ADD COLUMN IF NOT EXISTS "must_change_password" boolean DEFAULT false NOT NULL;
