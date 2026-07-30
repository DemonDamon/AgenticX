CREATE TABLE IF NOT EXISTS "chat_history_operations" (
  "operation_id" varchar(26) PRIMARY KEY NOT NULL,
  "tenant_id" varchar(26) NOT NULL,
  "user_id" varchar(26) NOT NULL,
  "session_id" varchar(26) NOT NULL,
  "payload_hash" varchar(64) NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "chat_history_operations_tenant_user_session_idx"
  ON "chat_history_operations" ("tenant_id", "user_id", "session_id");
