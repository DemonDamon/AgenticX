-- ECP E2: shelf lifecycle + platform catalog versions (MySQL).

ALTER TABLE `enterprise_skills` ADD COLUMN `shelf_status` varchar(16) NOT NULL DEFAULT 'published';
--> statement-breakpoint
UPDATE `enterprise_skills` SET `shelf_status` = 'deprecated' WHERE `status` = 'disabled';
--> statement-breakpoint
ALTER TABLE `platform_catalog_items` ADD COLUMN `shelf_status` varchar(16) NOT NULL DEFAULT 'draft';
--> statement-breakpoint
ALTER TABLE `platform_catalog_items` ADD COLUMN `effective_version_id` varchar(26);
--> statement-breakpoint
CREATE INDEX `platform_catalog_items_shelf_status_idx` ON `platform_catalog_items` (`shelf_status`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `platform_catalog_item_versions` (
  `id` varchar(26) NOT NULL,
  `catalog_item_id` varchar(26) NOT NULL,
  `version` varchar(32) NOT NULL DEFAULT '0.0.0',
  `bundle_uri` text,
  `bundle_digest` varchar(128),
  `scan_verdict` varchar(16),
  `scan_source` varchar(32),
  `scanned_at` varchar(32),
  `scanned_by` varchar(128),
  `scan_findings` json NOT NULL DEFAULT ('[]'),
  `shelf_status` varchar(16) NOT NULL DEFAULT 'draft',
  `created_at` timestamp NOT NULL DEFAULT (now()),
  `updated_at` timestamp NOT NULL DEFAULT (now()),
  CONSTRAINT `platform_catalog_item_versions_id` PRIMARY KEY(`id`),
  CONSTRAINT `platform_catalog_item_versions_catalog_fk` FOREIGN KEY (`catalog_item_id`) REFERENCES `platform_catalog_items`(`id`) ON DELETE CASCADE,
  CONSTRAINT `platform_catalog_item_versions_catalog_version_uq` UNIQUE(`catalog_item_id`,`version`),
  INDEX `platform_catalog_item_versions_catalog_idx` (`catalog_item_id`)
);
--> statement-breakpoint
INSERT INTO `platform_catalog_item_versions` (
  `id`,
  `catalog_item_id`,
  `version`,
  `bundle_uri`,
  `bundle_digest`,
  `shelf_status`,
  `scan_findings`,
  `created_at`,
  `updated_at`
)
SELECT
  LEFT(REPLACE(UUID(), '-', ''), 26),
  pci.`id`,
  pci.`version`,
  pci.`bundle_uri`,
  pci.`bundle_digest`,
  IF(pci.`status` = 'disabled', 'deprecated', 'published'),
  JSON_ARRAY(),
  pci.`created_at`,
  pci.`updated_at`
FROM `platform_catalog_items` pci
WHERE NOT EXISTS (
  SELECT 1 FROM `platform_catalog_item_versions` v WHERE v.`catalog_item_id` = pci.`id`
);
--> statement-breakpoint
UPDATE `platform_catalog_items` pci
INNER JOIN (
  SELECT `catalog_item_id`, `id` AS version_id
  FROM `platform_catalog_item_versions` v1
  WHERE v1.`updated_at` = (
    SELECT MAX(v2.`updated_at`)
    FROM `platform_catalog_item_versions` v2
    WHERE v2.`catalog_item_id` = v1.`catalog_item_id`
  )
) latest ON latest.`catalog_item_id` = pci.`id`
SET
  pci.`shelf_status` = IF(pci.`status` = 'disabled', 'deprecated', 'published'),
  pci.`effective_version_id` = latest.version_id
WHERE pci.`effective_version_id` IS NULL;
