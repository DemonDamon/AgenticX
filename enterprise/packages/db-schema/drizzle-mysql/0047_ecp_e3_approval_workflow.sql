-- ECP E3: approval workflow (MySQL).

CREATE TABLE `approval_workflow_presets` (
  `id` varchar(26) NOT NULL,
  `slug` varchar(64) NOT NULL,
  `display_name` varchar(128) NOT NULL,
  `step_definitions` json NOT NULL DEFAULT (JSON_ARRAY()),
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `approval_workflow_presets_slug_uq` ON `approval_workflow_presets` (`slug`);
--> statement-breakpoint
CREATE TABLE `approval_requests` (
  `id` varchar(26) NOT NULL,
  `tenant_id` varchar(26) NOT NULL,
  `preset_slug` varchar(64) NOT NULL,
  `resource_type` varchar(48) NOT NULL,
  `resource_id` varchar(26) NOT NULL,
  `action` varchar(32) NOT NULL,
  `status` varchar(16) NOT NULL DEFAULT 'pending',
  `requester_user_id` varchar(26) DEFAULT NULL,
  `requester_email` varchar(256) DEFAULT NULL,
  `rejection_reason` text,
  `context_json` json NOT NULL DEFAULT (JSON_OBJECT()),
  `consumed_at` varchar(32) DEFAULT NULL,
  `completed_at` varchar(32) DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  CONSTRAINT `approval_requests_tenant_id_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX `approval_requests_tenant_status_idx` ON `approval_requests` (`tenant_id`, `status`);
--> statement-breakpoint
CREATE INDEX `approval_requests_resource_idx` ON `approval_requests` (`resource_type`, `resource_id`, `action`);
--> statement-breakpoint
CREATE TABLE `approval_steps` (
  `id` varchar(26) NOT NULL,
  `request_id` varchar(26) NOT NULL,
  `step_order` int NOT NULL,
  `step_kind` varchar(16) NOT NULL,
  `actor_scope` varchar(32) DEFAULT NULL,
  `status` varchar(16) NOT NULL DEFAULT 'pending',
  `decision_note` text,
  `decided_by_user_id` varchar(26) DEFAULT NULL,
  `decided_by_email` varchar(256) DEFAULT NULL,
  `decided_at` varchar(32) DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  CONSTRAINT `approval_steps_request_id_fk` FOREIGN KEY (`request_id`) REFERENCES `approval_requests` (`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE UNIQUE INDEX `approval_steps_request_order_uq` ON `approval_steps` (`request_id`, `step_order`);
--> statement-breakpoint
CREATE INDEX `approval_steps_request_idx` ON `approval_steps` (`request_id`);
--> statement-breakpoint
CREATE TABLE `ecp_approval_settings` (
  `tenant_id` varchar(26) NOT NULL,
  `skill_publish_preset_slug` varchar(64) DEFAULT NULL,
  `platform_introduce_preset_slug` varchar(64) DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`tenant_id`),
  CONSTRAINT `ecp_approval_settings_tenant_id_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `ecp_platform_approval_settings` (
  `id` varchar(32) NOT NULL,
  `catalog_publish_preset_slug` varchar(64) DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
);
--> statement-breakpoint
INSERT INTO `approval_workflow_presets` (
  `id`,
  `slug`,
  `display_name`,
  `step_definitions`,
  `created_at`,
  `updated_at`
)
SELECT
  '01ECPPRESETENTERPRISEONLYA',
  'enterprise_admin_only',
  '企管单级',
  JSON_ARRAY(
    JSON_OBJECT('kind', 'auto_scan', 'actorScope', NULL),
    JSON_OBJECT('kind', 'manual', 'actorScope', 'enterprise_admin')
  ),
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM DUAL
WHERE NOT EXISTS (
  SELECT 1 FROM `approval_workflow_presets` WHERE `slug` = 'enterprise_admin_only'
);
--> statement-breakpoint
INSERT INTO `approval_workflow_presets` (
  `id`,
  `slug`,
  `display_name`,
  `step_definitions`,
  `created_at`,
  `updated_at`
)
SELECT
  '01ECPPRESETENTERPRISEPLAT',
  'enterprise_admin_platform',
  '企管+平台',
  JSON_ARRAY(
    JSON_OBJECT('kind', 'auto_scan', 'actorScope', NULL),
    JSON_OBJECT('kind', 'manual', 'actorScope', 'enterprise_admin'),
    JSON_OBJECT('kind', 'manual', 'actorScope', 'platform_operator')
  ),
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM DUAL
WHERE NOT EXISTS (
  SELECT 1 FROM `approval_workflow_presets` WHERE `slug` = 'enterprise_admin_platform'
);
--> statement-breakpoint
INSERT INTO `ecp_platform_approval_settings` (
  `id`,
  `catalog_publish_preset_slug`,
  `created_at`,
  `updated_at`
)
SELECT 'default', NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM DUAL
WHERE NOT EXISTS (
  SELECT 1 FROM `ecp_platform_approval_settings` WHERE `id` = 'default'
);
