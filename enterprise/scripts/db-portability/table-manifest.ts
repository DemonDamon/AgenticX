/**
 * Explicit 42-table migration order (parents before children).
 * `usage_records_daily_mv` is a VIEW created by MySQL migrations — not copied.
 */
export const TABLE_MANIFEST = [
  "tenants",
  "organizations",
  "departments",
  "users",
  "roles",
  "user_roles",
  "sso_providers",
  "auth_refresh_sessions",
  "session_grants",
  "api_tokens",
  "chat_sessions",
  "chat_messages",
  "policy_rule_packs",
  "policy_rules",
  "policy_rule_versions",
  "policy_publish_events",
  "enterprise_runtime_model_providers",
  "enterprise_runtime_user_visible_models",
  "enterprise_runtime_token_quotas",
  "enterprise_runtime_policy_snapshots",
  "enterprise_runtime_pricing",
  "enterprise_runtime_budgets",
  "enterprise_runtime_compliance",
  "enterprise_runtime_pat_revocation",
  "enterprise_runtime_mcp_servers",
  "enterprise_quota_plans",
  "enterprise_quota_plan_assignments",
  "gateway_channels",
  "mcp_servers",
  "mcp_tools",
  "usage_records",
  "agent_token_traces",
  "enterprise_business_revenue",
  "billing_split_rules",
  "billing_split_ledger",
  "billing_settlement_webhook_config",
  "billing_settlement_webhook_events",
  "audit_events",
  "gateway_audit_events",
  "gateway_budget_alerts",
  "gateway_quota_pool_usage",
  "gateway_quota_ledger",
] as const;

export type PortableTable = (typeof TABLE_MANIFEST)[number];

export const EXPECTED_TABLE_COUNT = 42;

export const SENSITIVE_COLUMNS = new Set([
  "password_hash",
  "token_hash",
  "client_secret",
  "client_secret_encrypted",
  "api_key",
  "api_key_ciphertext",
  "secret",
  "private_key",
]);
