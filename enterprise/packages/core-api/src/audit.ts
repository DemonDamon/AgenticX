export type AuditEventType =
  | "chat_call"
  | "tool_call"
  | "mcp_tool_call"
  | "policy_hit"
  | "auth_login"
  | "auth_logout"
  | "audit_export";

export type AuditRoute = "local" | "private-cloud" | "third-party";
export type AuditClientType = "web-portal" | "desktop" | "edge-agent" | "admin-console";
export type AuditPolicySeverity = "low" | "medium" | "high" | "critical";
export type AuditPolicyAction = "allow" | "redact" | "block";

export type AuditDigest = {
  prompt_hash: string;
  response_hash: string;
  prompt_summary?: string;
  response_summary?: string;
};

export type AuditPolicyHit = {
  policy_id: string;
  severity: AuditPolicySeverity;
  action: AuditPolicyAction;
  matched_rule?: string;
};

export interface AuditEvent {
  id: string;
  tenant_id: string;
  event_time: string; // ISO datetime (UTC)
  event_type: AuditEventType;

  user_id: string | null;
  user_email?: string;
  department_id?: string;
  session_id?: string;
  client_type: AuditClientType;
  client_ip?: string;

  provider?: string;
  model?: string;
  route: AuditRoute;
  channel_id?: string;
  channel_key_ref?: string;
  api_token_id?: number;

  input_tokens?: number;
  output_tokens?: number;
  total_tokens?: number;
  cost_usd?: number;
  latency_ms?: number;

  digest?: AuditDigest;
  tools_called?: string[];
  policies_hit?: AuditPolicyHit[];

  mcp_server?: string;
  mcp_tool_name?: string;
  mcp_input_hash?: string;
  mcp_output_hash?: string;
  mcp_status?: string;

  prev_checksum: string;
  checksum: string;
  checksum_version?: string;
  signature?: string;

  src_region?: string;
  dst_region?: string;
  cross_border?: boolean;
  residency_rule?: string;
}

export type AuditQueryInput = {
  tenant_id: string;
  user_id?: string;
  department_id?: string;
  provider?: string;
  model?: string;
  policy_hit?: string;
  cross_border?: boolean;
  start?: string;
  end?: string;
  limit?: number;
  offset?: number;
};

export type AuditQueryResult = {
  total: number;
  items: AuditEvent[];
  chain_valid: boolean;
  chain_error_at?: string;
  chain_error_reason?: string;
  chain_verification?: "full" | "partial";
  chain_verified_count?: number;
  chain_legacy_unverified?: number;
};
