CREATE TABLE IF NOT EXISTS `enterprise_runtime_virtual_models` (
  `id` varchar(26) NOT NULL,
  `tenant_id` varchar(26) NOT NULL,
  `name` varchar(128) NOT NULL,
  `display_name` varchar(256) NOT NULL,
  `enabled` boolean NOT NULL DEFAULT true,
  `targets` json NOT NULL DEFAULT (JSON_ARRAY()),
  `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  CONSTRAINT `enterprise_runtime_virtual_models_id` PRIMARY KEY (`id`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `enterprise_runtime_vm_tenant_name_uk`
  ON `enterprise_runtime_virtual_models` (`tenant_id`, `name`);
