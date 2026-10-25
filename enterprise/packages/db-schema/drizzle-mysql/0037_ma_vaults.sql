-- Managed Agents 凭证库（MySQL）。JSON 默认值写 DEFAULT (JSON_OBJECT()) / (JSON_ARRAY())；不写 CHARSET。
CREATE TABLE IF NOT EXISTS `ma_vaults` (
  `id` varchar(26) NOT NULL,
  `tenant_id` varchar(26) NOT NULL,
  `display_name` varchar(255) NOT NULL,
  `description` text,
  `metadata` json NOT NULL DEFAULT (JSON_OBJECT()),
  `status` varchar(16) NOT NULL DEFAULT 'active',
  `created_by` varchar(26),
  `archived_at` datetime(6),
  `created_at` datetime(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
  `updated_at` datetime(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
  CONSTRAINT `ma_vaults_id` PRIMARY KEY (`id`),
  CONSTRAINT `ma_vaults_tenant_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`) ON DELETE CASCADE,
  INDEX `ma_vaults_tenant_status_idx` (`tenant_id`, `status`, `created_at`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `ma_credentials` (
  `id` varchar(26) NOT NULL,
  `tenant_id` varchar(26) NOT NULL,
  `vault_id` varchar(26) NOT NULL,
  `display_name` varchar(255),
  `type` varchar(32) NOT NULL,
  `identity_kind` varchar(24) NOT NULL,
  `identity_key` varchar(512) NOT NULL,
  `active_identity_key` varchar(540),
  `public_config` json NOT NULL DEFAULT (JSON_OBJECT()),
  `secret_fields` json NOT NULL DEFAULT (JSON_ARRAY()),
  `secret_ciphertext` text,
  `wrapped_dek` text,
  `kek_id` varchar(32),
  `status` varchar(16) NOT NULL DEFAULT 'active',
  `expires_at` datetime(6),
  `last_rotated_at` datetime(6),
  `last_resolved_at` datetime(6),
  `created_by` varchar(26),
  `archived_at` datetime(6),
  `created_at` datetime(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
  `updated_at` datetime(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
  CONSTRAINT `ma_credentials_id` PRIMARY KEY (`id`),
  CONSTRAINT `ma_credentials_vault_fk` FOREIGN KEY (`vault_id`) REFERENCES `ma_vaults` (`id`) ON DELETE CASCADE,
  CONSTRAINT `ma_credentials_vault_active_identity_uq` UNIQUE (`vault_id`, `active_identity_key`),
  INDEX `ma_credentials_tenant_vault_idx` (`tenant_id`, `vault_id`, `created_at`)
);
