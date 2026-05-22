CREATE TABLE IF NOT EXISTS "api_tokens" (
  "id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  "tenant_id" varchar(26) NOT NULL,
  "user_id" varchar(26) NOT NULL,
  "dept_id" varchar(26),
  "name" varchar(128) NOT NULL,
  "token_hash" varchar(128) NOT NULL,
  "token_prefix" varchar(20) NOT NULL,
  "scopes" jsonb NOT NULL DEFAULT '[]',
  "status" varchar(16) NOT NULL DEFAULT 'active',
  "expire_at" timestamptz,
  "last_used_at" timestamptz,
  "created_by" varchar(26) NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "api_tokens_token_hash_uq" ON "api_tokens" ("token_hash");
CREATE INDEX IF NOT EXISTS "api_tokens_tenant_user_idx" ON "api_tokens" ("tenant_id", "user_id");
CREATE INDEX IF NOT EXISTS "api_tokens_status_idx" ON "api_tokens" ("status");
