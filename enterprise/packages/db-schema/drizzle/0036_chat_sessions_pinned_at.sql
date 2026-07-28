ALTER TABLE "chat_sessions" ADD COLUMN IF NOT EXISTS "pinned_at" timestamptz;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "chat_sessions_tenant_user_pinned_idx"
  ON "chat_sessions" ("tenant_id", "user_id", "pinned_at");
