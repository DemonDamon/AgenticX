CREATE TABLE IF NOT EXISTS "chat_share_snapshots" (
  "token" varchar(64) PRIMARY KEY NOT NULL,
  "session_id" varchar(26) NOT NULL,
  "tenant_id" varchar(26) NOT NULL,
  "user_id" varchar(26) NOT NULL,
  "title" varchar(160) NOT NULL,
  "messages" jsonb NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "revoked_at" timestamptz
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "chat_share_snapshots_session_idx"
  ON "chat_share_snapshots" ("tenant_id", "user_id", "session_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "chat_share_snapshots_created_idx"
  ON "chat_share_snapshots" ("created_at");
