CREATE TABLE IF NOT EXISTS `desktop_device_auth` (
	`device_id` varchar(36) NOT NULL,
	`tenant_id` varchar(26) NOT NULL,
	`device_secret_hash` varchar(128) NOT NULL,
	`device_name` varchar(128) NOT NULL DEFAULT 'Near Desktop',
	`status` varchar(16) NOT NULL DEFAULT 'pending',
	`user_id` varchar(26),
	`dept_id` varchar(26),
	`issued_token_id` bigint,
	`expires_at` datetime(6) NOT NULL,
	`approved_at` datetime(6),
	`consumed_at` datetime(6),
	`created_at` datetime(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
	`updated_at` datetime(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
	CONSTRAINT `desktop_device_auth_device_id` PRIMARY KEY(`device_id`)
);
--> statement-breakpoint
CREATE INDEX `desktop_device_auth_tenant_status_expires_idx` ON `desktop_device_auth` (`tenant_id`,`status`,`expires_at`);
--> statement-breakpoint
CREATE INDEX `desktop_device_auth_secret_hash_idx` ON `desktop_device_auth` (`device_secret_hash`);
