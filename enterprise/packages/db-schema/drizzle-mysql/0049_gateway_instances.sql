CREATE TABLE IF NOT EXISTS `gateway_instances` (
  `instance_id` varchar(255) NOT NULL,
  `tenant_scope` varchar(255) NOT NULL DEFAULT '',
  `last_seen_at` datetime(6) NOT NULL,
  `status_json` json NOT NULL,
  `updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`instance_id`)
);
--> statement-breakpoint
CREATE INDEX `gateway_instances_last_seen_idx` ON `gateway_instances` (`last_seen_at`);
