-- ECP E1: platform catalog + tenant distribution grants; enterprise_skills origin columns.

CREATE TABLE IF NOT EXISTS `platform_catalog_items` (
  `id` varchar(26) NOT NULL,
  `slug` varchar(128) NOT NULL,
  `display_name` varchar(128),
  `description` text,
  `resource_type` varchar(32) NOT NULL DEFAULT 'skill',
  `version` varchar(32) NOT NULL DEFAULT '0.0.0',
  `bundle_uri` text,
  `bundle_digest` varchar(128),
  `status` varchar(16) NOT NULL DEFAULT 'active',
  `created_at` timestamp NOT NULL DEFAULT (now()),
  `updated_at` timestamp NOT NULL DEFAULT (now()),
  CONSTRAINT `platform_catalog_items_id` PRIMARY KEY(`id`),
  CONSTRAINT `platform_catalog_items_slug_uq` UNIQUE(`slug`),
  INDEX `platform_catalog_items_status_idx` (`status`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `tenant_distribution_grants` (
  `id` varchar(26) NOT NULL,
  `catalog_item_id` varchar(26) NOT NULL,
  `tenant_id` varchar(26) NOT NULL,
  `status` varchar(16) NOT NULL DEFAULT 'granted',
  `revoke_policy` varchar(32),
  `granted_at` varchar(32) NOT NULL,
  `revoked_at` varchar(32),
  `created_at` timestamp NOT NULL DEFAULT (now()),
  `updated_at` timestamp NOT NULL DEFAULT (now()),
  CONSTRAINT `tenant_distribution_grants_id` PRIMARY KEY(`id`),
  CONSTRAINT `tenant_distribution_grants_catalog_tenant_uq` UNIQUE(`catalog_item_id`,`tenant_id`),
  CONSTRAINT `tenant_distribution_grants_catalog_fk` FOREIGN KEY (`catalog_item_id`) REFERENCES `platform_catalog_items`(`id`) ON DELETE CASCADE,
  CONSTRAINT `tenant_distribution_grants_tenant_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE CASCADE,
  INDEX `tenant_distribution_grants_tenant_status_idx` (`tenant_id`,`status`)
);
--> statement-breakpoint
ALTER TABLE `enterprise_skills` ADD `origin` varchar(16) NOT NULL DEFAULT 'tenant';
--> statement-breakpoint
ALTER TABLE `enterprise_skills` ADD `platform_catalog_item_id` varchar(26);
--> statement-breakpoint
CREATE INDEX `enterprise_skills_platform_catalog_idx` ON `enterprise_skills` (`tenant_id`,`platform_catalog_item_id`);
