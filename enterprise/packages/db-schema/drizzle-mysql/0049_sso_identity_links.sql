CREATE TABLE `sso_identity_links` (
  `tenant_id` varchar(26) NOT NULL,
  `identity_hash` varchar(64) NOT NULL,
  `provider_hash` varchar(64) NOT NULL,
  `provider_id` varchar(64) NOT NULL,
  `issuer` varchar(512) NOT NULL,
  `subject` varchar(255) NOT NULL,
  `user_id` varchar(26) NOT NULL,
  `created_at` datetime(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
  `updated_at` datetime(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
  CONSTRAINT `sso_identity_links_pk` PRIMARY KEY (`tenant_id`, `identity_hash`),
  CONSTRAINT `sso_identity_links_tenant_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE CASCADE,
  CONSTRAINT `sso_identity_links_user_tenant_fk` FOREIGN KEY (`user_id`, `tenant_id`) REFERENCES `users`(`id`, `tenant_id`) ON DELETE CASCADE,
  UNIQUE KEY `sso_identity_links_provider_user_uq` (`tenant_id`, `provider_hash`, `user_id`),
  KEY `sso_identity_links_tenant_user_idx` (`tenant_id`, `user_id`)
);
