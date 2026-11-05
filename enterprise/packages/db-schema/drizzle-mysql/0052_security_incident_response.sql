-- SP5 incident-response-loop: security_incidents / security_incident_actions / enterprise_runtime_session_revocation
CREATE TABLE IF NOT EXISTS `security_incidents` (
  `id` varchar(26) NOT NULL,
  `tenant_id` varchar(26) NOT NULL,
  `title` varchar(256) NOT NULL,
  `source` varchar(32) NOT NULL DEFAULT 'manual',
  `severity` varchar(16) NOT NULL DEFAULT 'high',
  `status` varchar(16) NOT NULL DEFAULT 'open',
  `trace_id` varchar(128),
  `session_id` varchar(160),
  `user_id` varchar(128),
  `model` varchar(128),
  `summary` text,
  `created_by` varchar(128),
  `handled_at` datetime(6),
  `resolved_at` datetime(6),
  `resolution_note` text,
  `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  CONSTRAINT `security_incidents_id` PRIMARY KEY (`id`)
);
--> statement-breakpoint
CREATE INDEX `security_incidents_tenant_status_idx`
  ON `security_incidents` (`tenant_id`, `status`);
--> statement-breakpoint
CREATE INDEX `security_incidents_tenant_trace_idx`
  ON `security_incidents` (`tenant_id`, `trace_id`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `security_incident_actions` (
  `id` varchar(26) NOT NULL,
  `incident_id` varchar(26) NOT NULL,
  `tenant_id` varchar(26) NOT NULL,
  `action_type` varchar(32) NOT NULL,
  `target_type` varchar(16) NOT NULL,
  `target_id` varchar(160),
  `actor_user_id` varchar(128),
  `detail` text,
  `outcome` varchar(16) NOT NULL,
  `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT `security_incident_actions_id` PRIMARY KEY (`id`)
);
--> statement-breakpoint
CREATE INDEX `security_incident_actions_incident_idx`
  ON `security_incident_actions` (`incident_id`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `enterprise_runtime_session_revocation` (
  `tenant_id` varchar(26) NOT NULL,
  `version` decimal(20, 0) NOT NULL DEFAULT '0',
  `revoked_session_ids` json NOT NULL DEFAULT (JSON_ARRAY()),
  `updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  CONSTRAINT `enterprise_runtime_session_revocation_tenant_id` PRIMARY KEY (`tenant_id`)
);
