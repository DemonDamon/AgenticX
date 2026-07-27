CREATE TABLE IF NOT EXISTS "enterprise_chat_artifacts" (
  "id" varchar(26) PRIMARY KEY NOT NULL,
  "tenant_id" varchar(26) NOT NULL,
  "user_id" varchar(26) NOT NULL,
  "session_id" varchar(26) NOT NULL,
  "run_id" varchar(26) NOT NULL,
  "path" text NOT NULL,
  "title" text NOT NULL,
  "kind" varchar(32) DEFAULT 'other' NOT NULL,
  "mime_type" varchar(128) DEFAULT 'text/markdown' NOT NULL,
  "content" text NOT NULL,
  "byte_size" integer NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "enterprise_chat_artifacts_session_path_uk"
  ON "enterprise_chat_artifacts" ("session_id", "path");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "enterprise_chat_artifacts_session_idx"
  ON "enterprise_chat_artifacts" ("tenant_id", "session_id", "created_at");
