CREATE TABLE `tenants` (
	`id` varchar(26) NOT NULL,
	`code` varchar(64) NOT NULL,
	`name` varchar(128) NOT NULL,
	`plan` varchar(32) NOT NULL DEFAULT 'enterprise',
	`created_at` datetime(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
	`updated_at` datetime(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
	CONSTRAINT `tenants_id` PRIMARY KEY(`id`),
	CONSTRAINT `tenants_code_uq` UNIQUE(`code`)
);
--> statement-breakpoint
CREATE TABLE `organizations` (
	`id` varchar(26) NOT NULL,
	`tenant_id` varchar(26) NOT NULL,
	`name` varchar(128) NOT NULL,
	`created_at` datetime(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
	`updated_at` datetime(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
	CONSTRAINT `organizations_id` PRIMARY KEY(`id`),
	CONSTRAINT `org_tenant_name_uq` UNIQUE(`tenant_id`,`name`)
);
--> statement-breakpoint
CREATE TABLE `departments` (
	`id` varchar(26) NOT NULL,
	`tenant_id` varchar(26) NOT NULL,
	`org_id` varchar(26) NOT NULL,
	`parent_id` varchar(26),
	`name` varchar(128) NOT NULL,
	`path` varchar(700) NOT NULL,
	`created_at` datetime(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
	`updated_at` datetime(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
	CONSTRAINT `departments_id` PRIMARY KEY(`id`),
	CONSTRAINT `dept_tenant_org_name_uq` UNIQUE(`tenant_id`,`org_id`,`name`),
	CONSTRAINT `dept_tenant_path_uq` UNIQUE(`tenant_id`,`path`)
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` varchar(26) NOT NULL,
	`tenant_id` varchar(26) NOT NULL,
	`dept_id` varchar(26),
	`email` varchar(320) NOT NULL,
	`display_name` varchar(128) NOT NULL,
	`password_hash` varchar(255) NOT NULL,
	`status` varchar(32) NOT NULL DEFAULT 'active',
	`phone` varchar(32),
	`employee_no` varchar(64),
	`job_title` varchar(128),
	`failed_login_count` int NOT NULL DEFAULT 0,
	`locked_until` datetime(6),
	`is_deleted` boolean NOT NULL DEFAULT false,
	`deleted_at` datetime(6),
	`created_at` datetime(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
	`updated_at` datetime(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
	`active_email_key` varchar(320) GENERATED ALWAYS AS ((CASE WHEN `is_deleted` = 0 AND `deleted_at` IS NULL THEN lower(`email`) ELSE NULL END)) STORED,
	CONSTRAINT `users_id` PRIMARY KEY(`id`),
	CONSTRAINT `users_tenant_email_active_uq` UNIQUE(`tenant_id`,`active_email_key`),
	CONSTRAINT `users_id_tenant_uq` UNIQUE(`id`,`tenant_id`)
);
--> statement-breakpoint
CREATE TABLE `roles` (
	`id` varchar(26) NOT NULL,
	`tenant_id` varchar(26) NOT NULL,
	`code` varchar(64) NOT NULL,
	`name` varchar(128) NOT NULL,
	`scopes` json NOT NULL DEFAULT ('[]'),
	`immutable` boolean NOT NULL DEFAULT false,
	`created_at` datetime(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
	`updated_at` datetime(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
	CONSTRAINT `roles_id` PRIMARY KEY(`id`),
	CONSTRAINT `roles_tenant_code_uq` UNIQUE(`tenant_id`,`code`)
);
--> statement-breakpoint
CREATE TABLE `user_roles` (
	`tenant_id` varchar(26) NOT NULL,
	`user_id` varchar(26) NOT NULL,
	`role_id` varchar(26) NOT NULL,
	`scope_org_id` varchar(26),
	`scope_dept_id` varchar(26),
	`created_at` datetime(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
	`updated_at` datetime(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
	CONSTRAINT `user_roles_pk` PRIMARY KEY(`tenant_id`,`user_id`,`role_id`)
);
--> statement-breakpoint
CREATE TABLE `usage_records` (
	`id` varchar(26) NOT NULL,
	`tenant_id` varchar(26) NOT NULL,
	`dept_id` varchar(64),
	`user_id` varchar(64),
	`api_token_id` bigint,
	`provider` varchar(64) NOT NULL,
	`model` varchar(128) NOT NULL,
	`route` varchar(32) NOT NULL,
	`time_bucket` datetime(6) NOT NULL,
	`input_tokens` decimal(20,0) NOT NULL DEFAULT '0',
	`output_tokens` decimal(20,0) NOT NULL DEFAULT '0',
	`total_tokens` decimal(20,0) NOT NULL DEFAULT '0',
	`cached_tokens` decimal(20,0) NOT NULL DEFAULT '0',
	`cache_read_input_tokens` decimal(20,0) NOT NULL DEFAULT '0',
	`cache_creation_input_tokens` decimal(20,0) NOT NULL DEFAULT '0',
	`reasoning_tokens` decimal(20,0) NOT NULL DEFAULT '0',
	`usage_source` varchar(32),
	`cost_usd` decimal(18,8) NOT NULL DEFAULT '0',
	`pricing_version` varchar(128),
	`trace_id` varchar(128),
	`trace_step` int,
	`created_at` datetime(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
	`updated_at` datetime(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
	CONSTRAINT `usage_records_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `audit_events` (
	`id` varchar(26) NOT NULL,
	`tenant_id` varchar(26) NOT NULL,
	`actor_user_id` varchar(26),
	`event_type` varchar(64) NOT NULL,
	`target_kind` varchar(32) NOT NULL,
	`target_id` varchar(64),
	`detail` json,
	`created_at` datetime(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
	`updated_at` datetime(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
	CONSTRAINT `audit_events_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `gateway_audit_events` (
	`id` varchar(26) NOT NULL,
	`tenant_id` varchar(26) NOT NULL,
	`event_time` datetime(6) NOT NULL,
	`event_type` varchar(64) NOT NULL,
	`user_id` varchar(128),
	`user_email` varchar(320),
	`department_id` varchar(128),
	`session_id` varchar(128),
	`client_type` varchar(32) NOT NULL DEFAULT 'web-portal',
	`client_ip` varchar(128),
	`provider` varchar(128),
	`model` varchar(128),
	`route` varchar(32) NOT NULL,
	`channel_id` varchar(26),
	`channel_key_ref` varchar(128),
	`api_token_id` bigint,
	`input_tokens` int,
	`output_tokens` int,
	`total_tokens` int,
	`latency_ms` bigint,
	`digest` json,
	`policies_hit` json,
	`tools_called` json,
	`mcp_server` varchar(128),
	`mcp_tool_name` varchar(128),
	`mcp_input_hash` varchar(128),
	`mcp_output_hash` varchar(128),
	`mcp_status` varchar(32),
	`src_region` varchar(16),
	`dst_region` varchar(16),
	`cross_border` boolean,
	`residency_rule` varchar(64),
	`prev_checksum` varchar(128) NOT NULL,
	`checksum` varchar(128) NOT NULL,
	`signature` varchar(256),
	`created_at` datetime(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
	`updated_at` datetime(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
	CONSTRAINT `gateway_audit_events_id` PRIMARY KEY(`id`),
	CONSTRAINT `gateway_audit_events_tenant_id_id_uq` UNIQUE(`tenant_id`,`id`)
);
--> statement-breakpoint
CREATE TABLE `policy_publish_events` (
	`id` varchar(26) NOT NULL,
	`tenant_id` varchar(26) NOT NULL,
	`version` int NOT NULL,
	`snapshot` json NOT NULL,
	`summary` json,
	`publisher` varchar(26),
	`published_at` datetime(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
	`status` varchar(16) NOT NULL DEFAULT 'published',
	`created_at` datetime(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
	`updated_at` datetime(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
	CONSTRAINT `policy_publish_events_id` PRIMARY KEY(`id`),
	CONSTRAINT `policy_publish_events_tenant_version_uq` UNIQUE(`tenant_id`,`version`)
);
--> statement-breakpoint
CREATE TABLE `policy_rule_packs` (
	`id` varchar(26) NOT NULL,
	`tenant_id` varchar(26) NOT NULL,
	`code` varchar(64) NOT NULL,
	`name` varchar(128) NOT NULL,
	`description` varchar(512),
	`source` varchar(16) NOT NULL DEFAULT 'custom',
	`enabled` boolean NOT NULL DEFAULT true,
	`applies_to` json NOT NULL DEFAULT ('{}'),
	`created_at` datetime(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
	`updated_at` datetime(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
	CONSTRAINT `policy_rule_packs_id` PRIMARY KEY(`id`),
	CONSTRAINT `policy_rule_packs_tenant_code_uq` UNIQUE(`tenant_id`,`code`)
);
--> statement-breakpoint
CREATE TABLE `policy_rule_versions` (
	`id` varchar(26) NOT NULL,
	`tenant_id` varchar(26) NOT NULL,
	`rule_id` varchar(26) NOT NULL,
	`version` int NOT NULL,
	`snapshot` json NOT NULL,
	`author` varchar(26),
	`created_at` datetime(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
	`updated_at` datetime(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
	CONSTRAINT `policy_rule_versions_id` PRIMARY KEY(`id`),
	CONSTRAINT `policy_rule_versions_tenant_rule_version_uq` UNIQUE(`tenant_id`,`rule_id`,`version`)
);
--> statement-breakpoint
CREATE TABLE `policy_rules` (
	`id` varchar(26) NOT NULL,
	`tenant_id` varchar(26) NOT NULL,
	`pack_id` varchar(26) NOT NULL,
	`code` varchar(64) NOT NULL,
	`kind` varchar(16) NOT NULL,
	`action` varchar(16) NOT NULL,
	`severity` varchar(16) NOT NULL,
	`message` varchar(512),
	`payload` json NOT NULL DEFAULT ('{}'),
	`applies_to` json,
	`status` varchar(16) NOT NULL DEFAULT 'draft',
	`updated_by` varchar(26),
	`created_at` datetime(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
	`updated_at` datetime(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
	CONSTRAINT `policy_rules_id` PRIMARY KEY(`id`),
	CONSTRAINT `policy_rules_tenant_pack_code_uq` UNIQUE(`tenant_id`,`pack_id`,`code`)
);
--> statement-breakpoint
CREATE TABLE `sso_providers` (
	`id` varchar(26) NOT NULL,
	`tenant_id` varchar(26) NOT NULL,
	`provider_id` varchar(64) NOT NULL,
	`display_name` varchar(128) NOT NULL,
	`protocol` varchar(16) NOT NULL DEFAULT 'oidc',
	`issuer` varchar(512),
	`client_id` varchar(256),
	`client_secret_encrypted` varchar(4096),
	`redirect_uri` varchar(512),
	`scopes` json NOT NULL DEFAULT ('["openid","profile","email"]'),
	`claim_mapping` json NOT NULL DEFAULT ('{}'),
	`saml_config` json,
	`default_role_codes` json NOT NULL DEFAULT ('["member"]'),
	`enabled` boolean NOT NULL DEFAULT false,
	`created_by` varchar(26),
	`updated_by` varchar(26),
	`created_at` datetime(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
	`updated_at` datetime(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
	CONSTRAINT `sso_providers_id` PRIMARY KEY(`id`),
	CONSTRAINT `sso_providers_tenant_provider_uq` UNIQUE(`tenant_id`,`provider_id`)
);
--> statement-breakpoint
CREATE TABLE `chat_sessions` (
	`id` varchar(26) NOT NULL,
	`tenant_id` varchar(26) NOT NULL,
	`user_id` varchar(26) NOT NULL,
	`title` varchar(160) NOT NULL,
	`active_model` varchar(160),
	`message_count` int NOT NULL DEFAULT 0,
	`last_message_at` datetime(6),
	`deleted_at` datetime(6),
	`created_at` datetime(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
	`updated_at` datetime(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
	CONSTRAINT `chat_sessions_id` PRIMARY KEY(`id`),
	CONSTRAINT `chat_sessions_id_tenant_user_uq` UNIQUE(`id`,`tenant_id`,`user_id`)
);
--> statement-breakpoint
CREATE TABLE `chat_messages` (
	`id` varchar(26) NOT NULL,
	`session_id` varchar(26) NOT NULL,
	`tenant_id` varchar(26) NOT NULL,
	`user_id` varchar(26) NOT NULL,
	`role` varchar(32) NOT NULL,
	`content` text NOT NULL,
	`model` varchar(160),
	`status` varchar(32) NOT NULL DEFAULT 'complete',
	`metadata` json,
	`created_at` datetime(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
	`updated_at` datetime(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
	CONSTRAINT `chat_messages_id` PRIMARY KEY(`id`),
	CONSTRAINT `chat_messages_role_check` CHECK(`chat_messages`.`role` in ('system', 'user', 'assistant', 'tool')),
	CONSTRAINT `chat_messages_status_check` CHECK(`chat_messages`.`status` in ('complete', 'streaming', 'failed'))
);
--> statement-breakpoint
CREATE TABLE `auth_refresh_sessions` (
	`session_id` varchar(160) NOT NULL,
	`user_id` varchar(128) NOT NULL,
	`tenant_id` varchar(26) NOT NULL,
	`dept_id` varchar(26),
	`email` text NOT NULL,
	`scopes_json` json NOT NULL,
	`expires_at` datetime(6) NOT NULL,
	`created_at` datetime(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
	CONSTRAINT `auth_refresh_sessions_session_id` PRIMARY KEY(`session_id`)
);
--> statement-breakpoint
CREATE TABLE `enterprise_runtime_budgets` (
	`tenant_id` varchar(26) NOT NULL,
	`config` json NOT NULL,
	`updated_at` datetime(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
	CONSTRAINT `enterprise_runtime_budgets_tenant_id` PRIMARY KEY(`tenant_id`)
);
--> statement-breakpoint
CREATE TABLE `enterprise_runtime_compliance` (
	`tenant_id` varchar(26) NOT NULL,
	`data_residency` varchar(16),
	`cross_border_action` varchar(32) NOT NULL DEFAULT 'allow',
	`audit_retention_years` int NOT NULL DEFAULT 6,
	`append_only` boolean NOT NULL DEFAULT true,
	`updated_at` datetime(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
	CONSTRAINT `enterprise_runtime_compliance_tenant_id` PRIMARY KEY(`tenant_id`)
);
--> statement-breakpoint
CREATE TABLE `enterprise_runtime_mcp_servers` (
	`tenant_id` varchar(26) NOT NULL,
	`config` json NOT NULL,
	`updated_at` datetime(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
	CONSTRAINT `enterprise_runtime_mcp_servers_tenant_id` PRIMARY KEY(`tenant_id`)
);
--> statement-breakpoint
CREATE TABLE `enterprise_runtime_model_providers` (
	`id` varchar(26) NOT NULL,
	`tenant_id` varchar(26) NOT NULL,
	`provider_id` varchar(128) NOT NULL,
	`display_name` text NOT NULL,
	`base_url` text NOT NULL,
	`api_key_cipher` text NOT NULL DEFAULT (''),
	`enabled` boolean NOT NULL DEFAULT true,
	`is_default` boolean NOT NULL DEFAULT false,
	`route` varchar(64) NOT NULL DEFAULT 'third-party',
	`env_key` text,
	`models` json NOT NULL DEFAULT ('[]'),
	`created_at` datetime(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
	`updated_at` datetime(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
	CONSTRAINT `enterprise_runtime_model_providers_id` PRIMARY KEY(`id`),
	CONSTRAINT `enterprise_runtime_mp_tenant_prov_uk` UNIQUE(`tenant_id`,`provider_id`)
);
--> statement-breakpoint
CREATE TABLE `enterprise_runtime_pat_revocation` (
	`tenant_id` varchar(26) NOT NULL,
	`version` decimal(20,0) NOT NULL DEFAULT '0',
	`revoked_hashes` json NOT NULL DEFAULT ('[]'),
	`updated_at` datetime(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
	CONSTRAINT `enterprise_runtime_pat_revocation_tenant_id` PRIMARY KEY(`tenant_id`)
);
--> statement-breakpoint
CREATE TABLE `enterprise_runtime_policy_snapshots` (
	`tenant_id` varchar(26) NOT NULL,
	`snapshot` json NOT NULL,
	`updated_at` datetime(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
	CONSTRAINT `enterprise_runtime_policy_snapshots_tenant_id` PRIMARY KEY(`tenant_id`)
);
--> statement-breakpoint
CREATE TABLE `enterprise_runtime_pricing` (
	`tenant_id` varchar(26) NOT NULL,
	`config` json NOT NULL,
	`updated_at` datetime(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
	CONSTRAINT `enterprise_runtime_pricing_tenant_id` PRIMARY KEY(`tenant_id`)
);
--> statement-breakpoint
CREATE TABLE `enterprise_runtime_token_quotas` (
	`tenant_id` varchar(26) NOT NULL,
	`config` json NOT NULL,
	`updated_at` datetime(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
	CONSTRAINT `enterprise_runtime_token_quotas_tenant_id` PRIMARY KEY(`tenant_id`)
);
--> statement-breakpoint
CREATE TABLE `enterprise_runtime_user_visible_models` (
	`tenant_id` varchar(26) NOT NULL,
	`assignment_key` varchar(320) NOT NULL,
	`model_id` varchar(256) NOT NULL,
	`created_at` datetime(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
	CONSTRAINT `enterprise_runtime_uvm_pk` PRIMARY KEY(`tenant_id`,`assignment_key`,`model_id`)
);
--> statement-breakpoint
CREATE TABLE `gateway_budget_alerts` (
	`id` varchar(64) NOT NULL,
	`tenant_id` varchar(26) NOT NULL,
	`dept_id` varchar(64),
	`user_id` varchar(64),
	`dimension` varchar(16) NOT NULL,
	`dimension_key` varchar(128) NOT NULL,
	`period` varchar(16) NOT NULL,
	`unit` varchar(16) NOT NULL,
	`alert_type` varchar(16) NOT NULL,
	`used_value` decimal(18,8) NOT NULL DEFAULT '0',
	`limit_value` decimal(18,8) NOT NULL DEFAULT '0',
	`warn_threshold_pct` decimal(5,2) NOT NULL DEFAULT '0',
	`description` text,
	`created_at` datetime(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
	CONSTRAINT `gateway_budget_alerts_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `session_grants` (
	`id` varchar(64) NOT NULL,
	`tenant_id` varchar(26) NOT NULL,
	`session_id` varchar(128) NOT NULL,
	`scopes` json NOT NULL,
	`expires_at` datetime(6) NOT NULL,
	`revoked_at` datetime(6),
	`created_by` varchar(64),
	`description` text,
	`created_at` datetime(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
	CONSTRAINT `session_grants_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `gateway_channels` (
	`id` varchar(26) NOT NULL,
	`tenant_id` varchar(26) NOT NULL,
	`name` varchar(128) NOT NULL,
	`provider_type` varchar(32) NOT NULL DEFAULT 'openai',
	`base_url` text NOT NULL,
	`api_key_cipher` text NOT NULL DEFAULT (''),
	`weight` int NOT NULL DEFAULT 1,
	`priority` int NOT NULL DEFAULT 0,
	`status` varchar(16) NOT NULL DEFAULT 'active',
	`supported_models` json NOT NULL DEFAULT ('[]'),
	`region` varchar(16),
	`metadata` json NOT NULL DEFAULT ('{}'),
	`created_at` datetime(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
	`updated_at` datetime(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
	CONSTRAINT `gateway_channels_id` PRIMARY KEY(`id`),
	CONSTRAINT `gateway_channels_tenant_name_uk` UNIQUE(`tenant_id`,`name`)
);
--> statement-breakpoint
CREATE TABLE `api_tokens` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`tenant_id` varchar(26) NOT NULL,
	`user_id` varchar(26) NOT NULL,
	`dept_id` varchar(26),
	`name` varchar(128) NOT NULL,
	`token_hash` varchar(128) NOT NULL,
	`token_prefix` varchar(20) NOT NULL,
	`scopes` json NOT NULL DEFAULT ('[]'),
	`status` varchar(16) NOT NULL DEFAULT 'active',
	`expire_at` datetime(6),
	`last_used_at` datetime(6),
	`created_by` varchar(26) NOT NULL,
	`created_at` datetime(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
	`updated_at` datetime(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
	CONSTRAINT `api_tokens_id` PRIMARY KEY(`id`),
	CONSTRAINT `api_tokens_token_hash_uq` UNIQUE(`token_hash`)
);
--> statement-breakpoint
CREATE TABLE `mcp_servers` (
	`id` varchar(26) NOT NULL,
	`tenant_id` varchar(26) NOT NULL,
	`name` varchar(64) NOT NULL,
	`display_name` varchar(128),
	`transport` varchar(32) NOT NULL DEFAULT 'streamable-http',
	`backend_type` varchar(32) NOT NULL,
	`backend_config` json NOT NULL DEFAULT ('{}'),
	`required_scopes` json NOT NULL DEFAULT ('[]'),
	`status` varchar(16) NOT NULL DEFAULT 'active',
	`rate_limit` json NOT NULL DEFAULT ('{}'),
	`created_at` datetime(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
	`updated_at` datetime(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
	CONSTRAINT `mcp_servers_id` PRIMARY KEY(`id`),
	CONSTRAINT `mcp_servers_tenant_name_uq` UNIQUE(`tenant_id`,`name`)
);
--> statement-breakpoint
CREATE TABLE `mcp_tools` (
	`id` varchar(26) NOT NULL,
	`server_id` varchar(26) NOT NULL,
	`tool_name` varchar(128) NOT NULL,
	`description` text,
	`input_schema` json NOT NULL DEFAULT ('{}'),
	`output_schema` json,
	`enabled` boolean NOT NULL DEFAULT true,
	`source_operation_id` varchar(128),
	`metadata` json NOT NULL DEFAULT ('{}'),
	`created_at` datetime(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
	`updated_at` datetime(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
	CONSTRAINT `mcp_tools_id` PRIMARY KEY(`id`),
	CONSTRAINT `mcp_tools_server_tool_uq` UNIQUE(`server_id`,`tool_name`)
);
--> statement-breakpoint
CREATE TABLE `enterprise_business_revenue` (
	`id` varchar(26) NOT NULL,
	`tenant_id` varchar(26) NOT NULL,
	`scenario_label` varchar(128) NOT NULL,
	`period_start` datetime(6) NOT NULL,
	`period_end` datetime(6) NOT NULL,
	`revenue_usd` decimal(18,8) NOT NULL,
	`notes` text,
	`created_at` datetime(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
	`updated_at` datetime(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
	CONSTRAINT `enterprise_business_revenue_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `billing_settlement_webhook_config` (
	`tenant_id` varchar(26) NOT NULL,
	`webhook_url` text,
	`enabled` boolean NOT NULL DEFAULT false,
	`updated_at` datetime(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
	CONSTRAINT `billing_settlement_webhook_config_tenant_id` PRIMARY KEY(`tenant_id`)
);
--> statement-breakpoint
CREATE TABLE `billing_settlement_webhook_events` (
	`id` varchar(26) NOT NULL,
	`tenant_id` varchar(26) NOT NULL,
	`payload` json NOT NULL,
	`status` varchar(32) NOT NULL,
	`response_status` bigint,
	`created_at` datetime(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
	CONSTRAINT `billing_settlement_webhook_events_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `billing_split_ledger` (
	`id` varchar(26) NOT NULL,
	`tenant_id` varchar(26) NOT NULL,
	`usage_record_id` varchar(26) NOT NULL,
	`rule_id` varchar(26) NOT NULL,
	`rule_version` varchar(64) NOT NULL,
	`participant_id` varchar(64) NOT NULL,
	`participant_label` varchar(128),
	`amount_micro_usd` bigint NOT NULL,
	`original_cost_micro_usd` bigint NOT NULL,
	`time_bucket` datetime(6) NOT NULL,
	`created_at` datetime(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
	CONSTRAINT `billing_split_ledger_id` PRIMARY KEY(`id`),
	CONSTRAINT `billing_split_ledger_usage_participant_rule_idx` UNIQUE(`usage_record_id`,`participant_id`,`rule_id`)
);
--> statement-breakpoint
CREATE TABLE `billing_split_rules` (
	`id` varchar(26) NOT NULL,
	`tenant_id` varchar(26) NOT NULL,
	`name` varchar(128) NOT NULL,
	`effective_start` datetime(6) NOT NULL,
	`effective_end` datetime(6),
	`split_mode` varchar(32) NOT NULL DEFAULT 'fixed_ratio',
	`participants` json NOT NULL,
	`billing_items` json,
	`enabled` boolean NOT NULL DEFAULT true,
	`created_at` datetime(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
	`updated_at` datetime(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
	CONSTRAINT `billing_split_rules_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `agent_token_traces` (
	`id` varchar(64) NOT NULL,
	`tenant_id` varchar(64) NOT NULL,
	`trace_id` varchar(128) NOT NULL,
	`step_no` int NOT NULL,
	`step_kind` varchar(32) NOT NULL DEFAULT 'model',
	`status` varchar(16) NOT NULL DEFAULT 'ok',
	`model` varchar(128),
	`provider` varchar(64),
	`input_tokens` int NOT NULL DEFAULT 0,
	`output_tokens` int NOT NULL DEFAULT 0,
	`reasoning_tokens` int NOT NULL DEFAULT 0,
	`total_tokens` int NOT NULL DEFAULT 0,
	`cost_usd` decimal(18,8) NOT NULL DEFAULT '0',
	`duration_ms` int NOT NULL DEFAULT 0,
	`error_message` text,
	`metadata` json,
	`created_at` datetime(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
	`updated_at` datetime(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
	CONSTRAINT `agent_token_traces_id` PRIMARY KEY(`id`),
	CONSTRAINT `agent_token_traces_trace_step_uq` UNIQUE(`tenant_id`,`trace_id`,`step_no`)
);
--> statement-breakpoint
CREATE TABLE `gateway_quota_ledger` (
	`id` varchar(64) NOT NULL,
	`tenant_id` varchar(26) NOT NULL,
	`scope_type` varchar(16) NOT NULL,
	`scope_id` varchar(128) NOT NULL,
	`period` varchar(16) NOT NULL,
	`event` varchar(16) NOT NULL,
	`delta_tokens` bigint NOT NULL,
	`request_id` varchar(128),
	`created_at` datetime(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
	CONSTRAINT `gateway_quota_ledger_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `gateway_quota_pool_usage` (
	`tenant_id` varchar(26) NOT NULL,
	`scope_type` varchar(16) NOT NULL,
	`scope_id` varchar(128) NOT NULL,
	`period` varchar(16) NOT NULL,
	`used_total` bigint NOT NULL DEFAULT 0,
	`updated_at` datetime(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
	CONSTRAINT `gateway_quota_pool_usage_pk` PRIMARY KEY(`tenant_id`,`scope_type`,`scope_id`,`period`)
);
--> statement-breakpoint
CREATE TABLE `enterprise_quota_plan_assignments` (
	`id` varchar(26) NOT NULL,
	`tenant_id` varchar(26) NOT NULL,
	`plan_id` varchar(26) NOT NULL,
	`scope_type` varchar(16) NOT NULL,
	`scope_id` varchar(128) NOT NULL,
	`period_start` datetime(6) NOT NULL,
	`period_end` datetime(6) NOT NULL,
	`status` varchar(16) NOT NULL DEFAULT 'active',
	`pending_plan_id` varchar(26),
	`last_rollover_key` varchar(128),
	`created_at` datetime(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
	`updated_at` datetime(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
	`active_scope_key` varchar(200) GENERATED ALWAYS AS ((CASE WHEN `status` = 'active' THEN concat(`scope_type`, ':', `scope_id`) ELSE NULL END)) STORED,
	CONSTRAINT `enterprise_quota_plan_assignments_id` PRIMARY KEY(`id`),
	CONSTRAINT `enterprise_quota_plan_assign_scope_active_uk` UNIQUE(`tenant_id`,`active_scope_key`)
);
--> statement-breakpoint
CREATE TABLE `enterprise_quota_plans` (
	`id` varchar(26) NOT NULL,
	`tenant_id` varchar(26) NOT NULL,
	`name` text NOT NULL,
	`monthly_tokens` bigint NOT NULL,
	`rpm` int NOT NULL DEFAULT 0,
	`tpm` int NOT NULL DEFAULT 0,
	`max_concurrency` int NOT NULL DEFAULT 0,
	`models` json NOT NULL DEFAULT ('[]'),
	`period` varchar(8) NOT NULL DEFAULT 'month',
	`status` varchar(16) NOT NULL DEFAULT 'draft',
	`created_at` datetime(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
	`updated_at` datetime(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
	CONSTRAINT `enterprise_quota_plans_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `organizations` ADD CONSTRAINT `organizations_tenant_id_tenants_id_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `departments` ADD CONSTRAINT `departments_tenant_id_tenants_id_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `departments` ADD CONSTRAINT `departments_org_id_organizations_id_fk` FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `users` ADD CONSTRAINT `users_tenant_id_tenants_id_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `users` ADD CONSTRAINT `users_dept_id_departments_id_fk` FOREIGN KEY (`dept_id`) REFERENCES `departments`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `roles` ADD CONSTRAINT `roles_tenant_id_tenants_id_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `user_roles` ADD CONSTRAINT `user_roles_tenant_id_tenants_id_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `user_roles` ADD CONSTRAINT `user_roles_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `user_roles` ADD CONSTRAINT `user_roles_role_id_roles_id_fk` FOREIGN KEY (`role_id`) REFERENCES `roles`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `user_roles` ADD CONSTRAINT `user_roles_scope_org_id_organizations_id_fk` FOREIGN KEY (`scope_org_id`) REFERENCES `organizations`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `user_roles` ADD CONSTRAINT `user_roles_scope_dept_id_departments_id_fk` FOREIGN KEY (`scope_dept_id`) REFERENCES `departments`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `usage_records` ADD CONSTRAINT `usage_records_tenant_id_tenants_id_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `audit_events` ADD CONSTRAINT `audit_events_tenant_id_tenants_id_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `audit_events` ADD CONSTRAINT `audit_events_actor_user_id_users_id_fk` FOREIGN KEY (`actor_user_id`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `gateway_audit_events` ADD CONSTRAINT `gateway_audit_events_tenant_id_tenants_id_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `policy_publish_events` ADD CONSTRAINT `policy_publish_events_tenant_id_tenants_id_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `policy_rule_packs` ADD CONSTRAINT `policy_rule_packs_tenant_id_tenants_id_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `policy_rule_versions` ADD CONSTRAINT `policy_rule_versions_tenant_id_tenants_id_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `policy_rule_versions` ADD CONSTRAINT `policy_rule_versions_rule_id_policy_rules_id_fk` FOREIGN KEY (`rule_id`) REFERENCES `policy_rules`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `policy_rules` ADD CONSTRAINT `policy_rules_tenant_id_tenants_id_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `policy_rules` ADD CONSTRAINT `policy_rules_pack_id_policy_rule_packs_id_fk` FOREIGN KEY (`pack_id`) REFERENCES `policy_rule_packs`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `sso_providers` ADD CONSTRAINT `sso_providers_tenant_id_tenants_id_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `chat_sessions` ADD CONSTRAINT `chat_sessions_tenant_id_tenants_id_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `chat_sessions` ADD CONSTRAINT `chat_sessions_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `chat_sessions` ADD CONSTRAINT `chat_sessions_user_tenant_fk` FOREIGN KEY (`user_id`,`tenant_id`) REFERENCES `users`(`id`,`tenant_id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `chat_messages` ADD CONSTRAINT `chat_messages_session_id_chat_sessions_id_fk` FOREIGN KEY (`session_id`) REFERENCES `chat_sessions`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `chat_messages` ADD CONSTRAINT `chat_messages_tenant_id_tenants_id_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `chat_messages` ADD CONSTRAINT `chat_messages_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `chat_messages` ADD CONSTRAINT `chat_messages_session_tenant_user_fk` FOREIGN KEY (`session_id`,`tenant_id`,`user_id`) REFERENCES `chat_sessions`(`id`,`tenant_id`,`user_id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `mcp_servers` ADD CONSTRAINT `mcp_servers_tenant_id_tenants_id_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `mcp_tools` ADD CONSTRAINT `mcp_tools_server_id_mcp_servers_id_fk` FOREIGN KEY (`server_id`) REFERENCES `mcp_servers`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `dept_tenant_parent_idx` ON `departments` (`tenant_id`,`parent_id`);--> statement-breakpoint
CREATE INDEX `users_tenant_dept_idx` ON `users` (`tenant_id`,`dept_id`);--> statement-breakpoint
CREATE INDEX `users_tenant_employee_no_idx` ON `users` (`tenant_id`,`employee_no`);--> statement-breakpoint
CREATE INDEX `user_roles_tenant_user_idx` ON `user_roles` (`tenant_id`,`user_id`);--> statement-breakpoint
CREATE INDEX `usage_records_tenant_time_idx` ON `usage_records` (`tenant_id`,`time_bucket`);--> statement-breakpoint
CREATE INDEX `usage_records_tenant_dims_idx` ON `usage_records` (`tenant_id`,`dept_id`,`user_id`,`provider`);--> statement-breakpoint
CREATE INDEX `audit_events_tenant_time_idx` ON `audit_events` (`tenant_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `audit_events_target_idx` ON `audit_events` (`tenant_id`,`target_kind`,`target_id`);--> statement-breakpoint
CREATE INDEX `gateway_audit_events_tenant_event_time_idx` ON `gateway_audit_events` (`tenant_id`,`event_time`);--> statement-breakpoint
CREATE INDEX `gateway_audit_events_tenant_user_event_time_idx` ON `gateway_audit_events` (`tenant_id`,`user_id`,`event_time`);--> statement-breakpoint
CREATE INDEX `gateway_audit_events_tenant_dept_event_time_idx` ON `gateway_audit_events` (`tenant_id`,`department_id`,`event_time`);--> statement-breakpoint
CREATE INDEX `gateway_audit_events_tenant_model_event_time_idx` ON `gateway_audit_events` (`tenant_id`,`model`,`event_time`);--> statement-breakpoint
CREATE INDEX `gateway_audit_events_cross_border_idx` ON `gateway_audit_events` (`tenant_id`,`cross_border`,`event_time`);--> statement-breakpoint
CREATE INDEX `policy_publish_events_tenant_published_idx` ON `policy_publish_events` (`tenant_id`,`published_at`);--> statement-breakpoint
CREATE INDEX `policy_rule_packs_tenant_updated_idx` ON `policy_rule_packs` (`tenant_id`,`updated_at`);--> statement-breakpoint
CREATE INDEX `policy_rule_versions_tenant_rule_idx` ON `policy_rule_versions` (`tenant_id`,`rule_id`);--> statement-breakpoint
CREATE INDEX `policy_rules_tenant_status_idx` ON `policy_rules` (`tenant_id`,`status`);--> statement-breakpoint
CREATE INDEX `policy_rules_tenant_pack_idx` ON `policy_rules` (`tenant_id`,`pack_id`);--> statement-breakpoint
CREATE INDEX `policy_rules_tenant_updated_idx` ON `policy_rules` (`tenant_id`,`updated_at`);--> statement-breakpoint
CREATE INDEX `sso_providers_tenant_enabled_idx` ON `sso_providers` (`tenant_id`,`enabled`);--> statement-breakpoint
CREATE INDEX `sso_providers_tenant_protocol_idx` ON `sso_providers` (`tenant_id`,`protocol`);--> statement-breakpoint
CREATE INDEX `chat_sessions_tenant_user_updated_idx` ON `chat_sessions` (`tenant_id`,`user_id`,`updated_at`);--> statement-breakpoint
CREATE INDEX `chat_sessions_tenant_user_deleted_idx` ON `chat_sessions` (`tenant_id`,`user_id`,`deleted_at`);--> statement-breakpoint
CREATE INDEX `chat_messages_session_created_idx` ON `chat_messages` (`session_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `chat_messages_tenant_user_session_idx` ON `chat_messages` (`tenant_id`,`user_id`,`session_id`);--> statement-breakpoint
CREATE INDEX `gateway_budget_alerts_tenant_time_idx` ON `gateway_budget_alerts` (`tenant_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `session_grants_tenant_session_idx` ON `session_grants` (`tenant_id`,`session_id`,`expires_at`);--> statement-breakpoint
CREATE INDEX `api_tokens_tenant_user_idx` ON `api_tokens` (`tenant_id`,`user_id`);--> statement-breakpoint
CREATE INDEX `api_tokens_status_idx` ON `api_tokens` (`status`);--> statement-breakpoint
CREATE INDEX `mcp_servers_tenant_status_idx` ON `mcp_servers` (`tenant_id`,`status`);--> statement-breakpoint
CREATE INDEX `mcp_tools_server_enabled_idx` ON `mcp_tools` (`server_id`,`enabled`);--> statement-breakpoint
CREATE INDEX `billing_settlement_webhook_events_tenant_idx` ON `billing_settlement_webhook_events` (`tenant_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `billing_split_ledger_tenant_time_idx` ON `billing_split_ledger` (`tenant_id`,`time_bucket`);--> statement-breakpoint
CREATE INDEX `billing_split_ledger_tenant_participant_idx` ON `billing_split_ledger` (`tenant_id`,`participant_id`);--> statement-breakpoint
CREATE INDEX `billing_split_rules_tenant_effective_idx` ON `billing_split_rules` (`tenant_id`,`effective_start`,`effective_end`);--> statement-breakpoint
CREATE INDEX `agent_token_traces_trace_idx` ON `agent_token_traces` (`tenant_id`,`trace_id`);--> statement-breakpoint
CREATE INDEX `gateway_quota_ledger_scope_idx` ON `gateway_quota_ledger` (`tenant_id`,`scope_type`,`scope_id`,`period`);--> statement-breakpoint
CREATE INDEX `enterprise_quota_plan_assign_plan_idx` ON `enterprise_quota_plan_assignments` (`tenant_id`,`plan_id`);--> statement-breakpoint
CREATE INDEX `enterprise_quota_plans_tenant_status_idx` ON `enterprise_quota_plans` (`tenant_id`,`status`);

--> statement-breakpoint
CREATE OR REPLACE VIEW `usage_records_daily_mv` AS
SELECT
  tenant_id,
  dept_id,
  user_id,
  provider,
  model,
  CAST(DATE(`time_bucket`) AS DATETIME(6)) AS day_bucket,
  CAST(SUM(input_tokens) AS DECIMAL(20,0)) AS input_tokens,
  CAST(SUM(output_tokens) AS DECIMAL(20,0)) AS output_tokens,
  CAST(SUM(total_tokens) AS DECIMAL(20,0)) AS total_tokens,
  CAST(SUM(cost_usd) AS DECIMAL(18,8)) AS cost_usd
FROM usage_records
GROUP BY tenant_id, dept_id, user_id, provider, model, DATE(`time_bucket`);
