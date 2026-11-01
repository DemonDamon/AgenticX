-- ECP E4: expert_package manifest, install copies, tenant distribution policy.

ALTER TABLE `platform_catalog_item_versions` ADD COLUMN `pack_manifest` json NOT NULL DEFAULT (JSON_OBJECT());
--> statement-breakpoint
ALTER TABLE `enterprise_skills` ADD COLUMN `install_copy_of` varchar(64);
--> statement-breakpoint
ALTER TABLE `enterprise_capability_packs` ADD COLUMN `origin` varchar(16) NOT NULL DEFAULT 'tenant';
--> statement-breakpoint
ALTER TABLE `enterprise_capability_packs` ADD COLUMN `platform_catalog_item_id` varchar(26);
--> statement-breakpoint
CREATE INDEX `enterprise_capability_packs_platform_catalog_idx`
  ON `enterprise_capability_packs` (`tenant_id`, `platform_catalog_item_id`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `ecp_tenant_settings` (
  `tenant_id` varchar(26) NOT NULL,
  `install_copy_enabled` boolean NOT NULL DEFAULT false,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `ecp_tenant_settings_tenant_id` PRIMARY KEY(`tenant_id`),
  CONSTRAINT `ecp_tenant_settings_tenant_id_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`) ON DELETE CASCADE
);
