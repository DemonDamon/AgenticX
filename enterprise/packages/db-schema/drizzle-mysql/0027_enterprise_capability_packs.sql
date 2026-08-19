-- 企业能力包（MySQL）。text[] 在此方言下落为 json，与 mcp_servers.required_scopes 一致。

CREATE TABLE IF NOT EXISTS `enterprise_skills` (
  `id` varchar(26) NOT NULL,
  `tenant_id` varchar(26) NOT NULL,
  `slug` varchar(128) NOT NULL,
  `display_name` varchar(128),
  `description` text,
  `version` varchar(32) NOT NULL DEFAULT '0.0.0',
  `bundle_uri` text,
  `bundle_digest` varchar(128),
  `required_capabilities` json NOT NULL,
  `status` varchar(16) NOT NULL DEFAULT 'active',
  `created_at` datetime(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
  `updated_at` datetime(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
  CONSTRAINT `enterprise_skills_id` PRIMARY KEY(`id`),
  CONSTRAINT `enterprise_skills_tenant_slug_uq` UNIQUE(`tenant_id`,`slug`),
  CONSTRAINT `enterprise_skills_tenant_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE CASCADE,
  INDEX `enterprise_skills_tenant_status_idx` (`tenant_id`,`status`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `enterprise_capability_packs` (
  `id` varchar(26) NOT NULL,
  `tenant_id` varchar(26) NOT NULL,
  `slug` varchar(128) NOT NULL,
  `display_name` varchar(128),
  `description` text,
  `status` varchar(16) NOT NULL DEFAULT 'active',
  `metadata` json NOT NULL,
  `created_at` datetime(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
  `updated_at` datetime(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
  CONSTRAINT `enterprise_capability_packs_id` PRIMARY KEY(`id`),
  CONSTRAINT `enterprise_capability_packs_tenant_slug_uq` UNIQUE(`tenant_id`,`slug`),
  CONSTRAINT `enterprise_capability_packs_tenant_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE CASCADE,
  INDEX `enterprise_capability_packs_tenant_status_idx` (`tenant_id`,`status`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `enterprise_capability_pack_members` (
  `pack_id` varchar(26) NOT NULL,
  `capability_id` varchar(64) NOT NULL,
  `created_at` datetime(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
  `updated_at` datetime(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
  CONSTRAINT `enterprise_capability_pack_members_pk` PRIMARY KEY(`pack_id`,`capability_id`),
  CONSTRAINT `enterprise_capability_pack_members_pack_fk` FOREIGN KEY (`pack_id`) REFERENCES `enterprise_capability_packs`(`id`) ON DELETE CASCADE,
  INDEX `enterprise_capability_pack_members_capability_idx` (`capability_id`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `enterprise_capability_assignments` (
  `tenant_id` varchar(26) NOT NULL,
  `pack_id` varchar(26) NOT NULL,
  `assignment_key` varchar(128) NOT NULL,
  `created_at` datetime(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
  `updated_at` datetime(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
  CONSTRAINT `enterprise_capability_assignments_pk` PRIMARY KEY(`tenant_id`,`pack_id`,`assignment_key`),
  CONSTRAINT `enterprise_capability_assignments_tenant_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE CASCADE,
  CONSTRAINT `enterprise_capability_assignments_pack_fk` FOREIGN KEY (`pack_id`) REFERENCES `enterprise_capability_packs`(`id`) ON DELETE CASCADE,
  INDEX `enterprise_capability_assignments_tenant_key_idx` (`tenant_id`,`assignment_key`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `enterprise_capability_opt_outs` (
  `tenant_id` varchar(26) NOT NULL,
  `user_id` varchar(64) NOT NULL,
  `capability_id` varchar(64) NOT NULL,
  `created_at` datetime(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
  `updated_at` datetime(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
  CONSTRAINT `enterprise_capability_opt_outs_pk` PRIMARY KEY(`tenant_id`,`user_id`,`capability_id`),
  CONSTRAINT `enterprise_capability_opt_outs_tenant_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE CASCADE
);
