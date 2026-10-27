-- Managed Agents 凭证库：ma_vaults / ma_credentials。唯一写入方：admin-console（iam-core repos）。
-- 密钥只以信封密文存在：secret_ciphertext = encryptSecret(JSON, DEK)，wrapped_dek = encryptSecret(DEK, MA_VAULT_MASTER_KEY)。
-- active_identity_key：active 时为 "<identity_kind>:<identity_key>"，归档后置 NULL，用于同一 Vault 内匹配键唯一。
CREATE TABLE IF NOT EXISTS "ma_vaults" (
  "id" varchar(26) PRIMARY KEY NOT NULL,
  "tenant_id" varchar(26) NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "display_name" varchar(255) NOT NULL,
  "description" text,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "status" varchar(16) DEFAULT 'active' NOT NULL,
  "created_by" varchar(26),
  "archived_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ma_vaults_tenant_status_idx"
  ON "ma_vaults" ("tenant_id", "status", "created_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ma_credentials" (
  "id" varchar(26) PRIMARY KEY NOT NULL,
  "tenant_id" varchar(26) NOT NULL,
  "vault_id" varchar(26) NOT NULL REFERENCES "ma_vaults"("id") ON DELETE CASCADE,
  "display_name" varchar(255),
  "type" varchar(32) NOT NULL,
  "identity_kind" varchar(24) NOT NULL,
  "identity_key" varchar(512) NOT NULL,
  "active_identity_key" varchar(540),
  "public_config" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "secret_fields" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "secret_ciphertext" text,
  "wrapped_dek" text,
  "kek_id" varchar(32),
  "status" varchar(16) DEFAULT 'active' NOT NULL,
  "expires_at" timestamp with time zone,
  "last_rotated_at" timestamp with time zone,
  "last_resolved_at" timestamp with time zone,
  "created_by" varchar(26),
  "archived_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ma_credentials_vault_active_identity_uq"
  ON "ma_credentials" ("vault_id", "active_identity_key");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ma_credentials_tenant_vault_idx"
  ON "ma_credentials" ("tenant_id", "vault_id", "created_at");
