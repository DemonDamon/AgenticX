CREATE TABLE IF NOT EXISTS "enterprise_chat_attachments" (
  "id" varchar(26) PRIMARY KEY NOT NULL,
  "tenant_id" varchar(26) NOT NULL,
  "user_id" varchar(26) NOT NULL,
  "session_id" varchar(26),
  "file_name" text NOT NULL,
  "mime_type" varchar(128) NOT NULL,
  "byte_size" bigint NOT NULL,
  "kind" varchar(32) DEFAULT 'document' NOT NULL,
  "storage_driver" varchar(16) DEFAULT 'fs' NOT NULL,
  "storage_key" text NOT NULL,
  "checksum" varchar(64) NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "expires_at" timestamptz
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "enterprise_chat_attachments_owner_idx"
  ON "enterprise_chat_attachments" ("tenant_id", "user_id", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "enterprise_chat_attachments_session_idx"
  ON "enterprise_chat_attachments" ("tenant_id", "session_id");
