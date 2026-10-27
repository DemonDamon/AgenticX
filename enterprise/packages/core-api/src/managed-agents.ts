/**
 * Managed Agents wire protocol `agx-ma/2026-11`.
 *
 * Validation rules and error strings match `agenticx/managed/manifest.py`.
 */

import { createHash } from "crypto";

export const PROTOCOL_VERSION = "agx-ma/2026-11" as const;
export const MANIFEST_SCHEMA = "agx.agent/v1" as const;

export const CLIENT_EVENT_TYPES = [
  "user.message",
  "user.interrupt",
  "user.tool_confirmation",
  "user.custom_tool_result",
] as const;

export const SERVER_EVENT_TYPES = [
  "agent.message",
  "agent.thinking",
  "agent.tool_use",
  "agent.tool_result",
  "agent.mcp_tool_use",
  "agent.mcp_tool_result",
  "agent.custom_tool_use",
  "session.status_running",
  "session.status_idle",
  "session.status_terminated",
  "session.error",
  "session.usage",
  "span.model_request_start",
  "span.model_request_end",
  "session.task_created",
  "session.task_completed",
  "session.thread_created",
  "session.thread_status_running",
  "session.thread_status_idle",
  "session.thread_status_terminated",
  "agent.thread_message_sent",
  "agent.thread_message_received",
] as const;

export const PAT_SCOPES = [
  "ma:agents:read",
  "ma:agents:write",
  "ma:environments:read",
  "ma:environments:write",
  "ma:sessions:read",
  "ma:sessions:write",
  "ma:sessions:on_behalf",
  "ma:worker",
  "ma:vaults:read",
  "ma:vaults:write",
  "ma:memory:read",
  "ma:memory:write",
  "ma:schedules:read",
  "ma:schedules:write",
  "ma:webhooks:read",
  "ma:webhooks:write",
  "ma:channels:read",
  "ma:channels:write",
  "ma:admin",
] as const;

export const MA_WEBHOOK_EVENT_GROUPS = [
  { key: "session", types: ["session.status_run_started", "session.status_idled", "session.idle", "session.failed"] },
  { key: "thread", types: ["session.thread_created", "session.thread_idled", "session.thread_terminated"] },
  { key: "agent", types: ["agent.created", "agent.version_published", "agent.deleted"] },
  { key: "environment", types: ["environment.created", "environment.updated", "environment.deleted"] },
  {
    key: "vault",
    types: [
      "vault.created",
      "vault.archived",
      "vault.deleted",
      "vault_credential.created",
      "vault_credential.archived",
      "vault_credential.deleted",
      "credential.expiring",
    ],
  },
  { key: "memory_store", types: ["memory_store.created", "memory_store.archived", "memory_store.deleted"] },
  { key: "schedule", types: ["schedule.created", "schedule.updated", "schedule.deleted"] },
  { key: "schedule_run", types: ["schedule_run.started", "schedule_run.succeeded", "schedule_run.failed"] },
] as const;
export type MaWebhookEventGroupKey = (typeof MA_WEBHOOK_EVENT_GROUPS)[number]["key"];
export type MaWebhookEventType = (typeof MA_WEBHOOK_EVENT_GROUPS)[number]["types"][number];
export const MA_WEBHOOK_EVENT_TYPES: readonly MaWebhookEventType[] = MA_WEBHOOK_EVENT_GROUPS.flatMap((group) => group.types);
export const MA_WEBHOOK_RESOURCE_EVENT_TYPES = [
  "agent.created",
  "agent.version_published",
  "agent.deleted",
  "environment.created",
  "environment.updated",
  "environment.deleted",
  "vault.created",
  "vault.archived",
  "vault.deleted",
  "vault_credential.created",
  "vault_credential.archived",
  "vault_credential.deleted",
  "memory_store.created",
  "memory_store.archived",
  "memory_store.deleted",
  "schedule.created",
  "schedule.updated",
  "schedule.deleted",
] as const satisfies readonly MaWebhookEventType[];
export type MaWebhookResourceEventType = (typeof MA_WEBHOOK_RESOURCE_EVENT_TYPES)[number];

export const MAX_EVENTS_PER_BATCH = 10 as const;
export const SSE_PING_INTERVAL_SECONDS = 15 as const;
export const WORK_LEASE_TTL_SECONDS = 120 as const;
export const WORK_HEARTBEAT_INTERVAL_SECONDS = 15 as const;
export const WORK_STOP_GRACE_SECONDS = 60 as const;
export const WORK_POLL_MAX_WAIT_SECONDS = 25 as const;
export const MAX_MANIFEST_BYTES = 262144 as const;
export const MAX_SYSTEM_BYTES = 65536 as const;
export const MULTIAGENT_MAX_MEMBERS = 20 as const;
export const MAX_ADVISOR_INSTRUCTIONS_BYTES = 8192 as const;

export const MA_ERROR_CODES = {
  invalid_request: 400,
  invalid_event_batch: 400,
  duplicate_resolution: 400,
  manifest_invalid: 400,
  unauthorized: 401,
  forbidden_scope: 403,
  session_not_found: 404,
  agent_not_found: 404,
  agent_version_not_found: 404,
  environment_not_found: 404,
  resolution_not_found: 404,
  session_requires_action: 409,
  resolution_conflict: 409,
  work_lease_lost: 409,
  session_terminated: 409,
  internal_error: 500,
  task_not_found: 404,
  thread_not_found: 404,
} as const;

export type MAErrorCode = keyof typeof MA_ERROR_CODES;
export type ClientEventType = (typeof CLIENT_EVENT_TYPES)[number];
export type ServerEventType = (typeof SERVER_EVENT_TYPES)[number];
export type SessionStatus = "idle" | "running" | "rescheduling" | "terminated" | "archived";
export type StopReasonType =
  | "end_turn"
  | "requires_action"
  | "retries_exhausted"
  | "refusal"
  | "max_tool_rounds"
  | "budget_exceeded"
  | "policy_blocked";
export type EnvironmentType = "cloud" | "desktop_worker";
export type SessionSource = "portal" | "desktop" | "api" | "schedule" | "channel" | "eval";
export type ToolPolicy = "always_allow" | "always_ask";
export type WorkItemStatus = "queued" | "claimed" | "running" | "completed" | "failed" | "stopped";
export type RetryStatusType = "retrying" | "exhausted" | "terminal";
export type ImageMediaType = "image/jpeg" | "image/png" | "image/gif" | "image/webp";

export interface TextBlock {
  type: "text";
  text: string;
}

export interface Base64Source {
  type: "base64";
  media_type: ImageMediaType;
  data: string;
}

export interface UrlSource {
  type: "url";
  url: string;
}

export interface FileSource {
  type: "file";
  file_id: string;
}

export interface ImageBlock {
  type: "image";
  source: Base64Source | UrlSource | FileSource;
}

export interface TextDocSource {
  type: "text";
  text: string;
}

export interface DocumentBlock {
  type: "document";
  source: TextDocSource | FileSource;
  title?: string | null;
}

export type ContentBlock = TextBlock | ImageBlock | DocumentBlock;

export interface EventBase {
  id?: string | null;
  session_id?: string | null;
  seq?: number | null;
  thread_id?: string | null;
  created_at?: string | null;
  processed_at?: string | null;
}

export interface UserMessage extends EventBase {
  type: "user.message";
  content: ContentBlock[];
}

export interface UserInterrupt extends EventBase {
  type: "user.interrupt";
}

export interface UserToolConfirmation extends EventBase {
  type: "user.tool_confirmation";
  tool_use_id: string;
  result: "allow" | "deny";
  deny_message?: string | null;
}

export interface UserCustomToolResult extends EventBase {
  type: "user.custom_tool_result";
  custom_tool_use_id: string;
  content?: ContentBlock[];
  is_error?: boolean;
}

export type ClientEvent = UserMessage | UserInterrupt | UserToolConfirmation | UserCustomToolResult;

export interface StopReason {
  type: StopReasonType;
  event_ids: string[];
}

export interface RetryStatus {
  type: RetryStatusType;
}

export interface ErrorInfo {
  type: string;
  message: string;
  retry_status: RetryStatus;
  mcp_server?: string | null;
}

export interface Usage {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens: number;
  tool_calls: number;
  runtime_ms: number;
}

export interface AgentMessage extends EventBase {
  type: "agent.message";
  content: ContentBlock[];
}

export interface AgentThinking extends EventBase {
  type: "agent.thinking";
  content: TextBlock[];
}

export interface AgentToolUse extends EventBase {
  type: "agent.tool_use";
  name: string;
  input: Record<string, unknown>;
  evaluated_policy: ToolPolicy;
}

export interface AgentToolResult extends EventBase {
  type: "agent.tool_result";
  tool_use_id: string;
  content: ContentBlock[];
  is_error: boolean;
}

export interface AgentMcpToolUse extends EventBase {
  type: "agent.mcp_tool_use";
  mcp_server: string;
  name: string;
  input: Record<string, unknown>;
  evaluated_policy: ToolPolicy;
}

export interface AgentMcpToolResult extends EventBase {
  type: "agent.mcp_tool_result";
  mcp_tool_use_id: string;
  content: ContentBlock[];
  is_error: boolean;
}

export interface AgentCustomToolUse extends EventBase {
  type: "agent.custom_tool_use";
  name: string;
  input: Record<string, unknown>;
}

export interface SessionStatusRunning extends EventBase {
  type: "session.status_running";
}

export interface SessionStatusIdle extends EventBase {
  type: "session.status_idle";
  stop_reason: StopReason;
}

export interface SessionStatusTerminated extends EventBase {
  type: "session.status_terminated";
  reason?: string | null;
}

export interface SessionErrorEvent extends EventBase {
  type: "session.error";
  error: ErrorInfo;
}

export interface SessionUsage extends EventBase {
  type: "session.usage";
  usage: Usage;
}

export interface SpanModelRequestStart extends EventBase {
  type: "span.model_request_start";
  model: string;
}

export interface SpanModelRequestEnd extends EventBase {
  type: "span.model_request_end";
  model: string;
  is_error: boolean;
  model_usage: Usage;
}

export interface SessionTaskCreated extends EventBase {
  type: "session.task_created";
  task_id: string;
  tool: { name: string; tool_use_id?: string | null };
  summary: string;
  log_path?: string | null;
}

export interface SessionTaskCompleted extends EventBase {
  type: "session.task_completed";
  task_id: string;
  state: "succeeded" | "failed" | "cancelled";
  summary: string;
  result?: { status: "ok" | "error"; exit_code?: number | null; output: string } | null;
  error?: { type: string; message: string } | null;
  duration_ms: number;
}

export interface ThreadAgentRef {
  type: "self" | "agent" | "advisor";
  agent_id?: string | null;
  agent_version?: number | null;
  name?: string | null;
  model?: string | null;
}

export interface SessionThreadCreated extends EventBase {
  type: "session.thread_created";
  agent: ThreadAgentRef;
  parent_thread_id?: string | null;
}

export interface SessionThreadStatusRunning extends EventBase {
  type: "session.thread_status_running";
}

export interface SessionThreadStatusIdle extends EventBase {
  type: "session.thread_status_idle";
  stop_reason: StopReason;
}

export interface SessionThreadStatusTerminated extends EventBase {
  type: "session.thread_status_terminated";
  reason: "completed" | "archived" | "context_lost" | "host_restarted" | "session_closed";
}

export interface AgentThreadMessageSent extends EventBase {
  type: "agent.thread_message_sent";
  to_thread_id?: string | null;
  to_agent_name: string;
  content: ContentBlock[];
}

export interface AgentThreadMessageReceived extends EventBase {
  type: "agent.thread_message_received";
  from_thread_id?: string | null;
  from_agent_name: string;
  content: ContentBlock[];
}

export type ServerEvent =
  | AgentMessage
  | AgentThinking
  | AgentToolUse
  | AgentToolResult
  | AgentMcpToolUse
  | AgentMcpToolResult
  | AgentCustomToolUse
  | SessionStatusRunning
  | SessionStatusIdle
  | SessionStatusTerminated
  | SessionErrorEvent
  | SessionUsage
  | SpanModelRequestStart
  | SpanModelRequestEnd
  | SessionTaskCreated
  | SessionTaskCompleted
  | SessionThreadCreated
  | SessionThreadStatusRunning
  | SessionThreadStatusIdle
  | SessionThreadStatusTerminated
  | AgentThreadMessageSent
  | AgentThreadMessageReceived;

export interface EventStartFrame {
  type: "event_start";
  event: Record<string, unknown>;
}

export interface EventDeltaFrame {
  type: "event_delta";
  event_type: "agent.message" | "agent.thinking";
  content_delta: string;
}

export interface ToolConfig {
  name: string;
  policy: ToolPolicy | null;
  enabled: boolean;
}

export interface BuiltinToolset {
  type: "agx_builtin";
  default_policy: ToolPolicy;
  configs: ToolConfig[];
}

export interface McpToolset {
  type: "mcp";
  server: string;
  default_policy: ToolPolicy;
  configs: ToolConfig[];
}

export interface CustomTool {
  type: "custom";
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export type Toolset = BuiltinToolset | McpToolset | CustomTool;

export interface McpServer {
  name: string;
  url: string;
  transport: "http" | "sse";
}

export interface SkillRef {
  source: "builtin" | "tenant";
  id: string;
  version: string | null;
}

export interface RuntimeLimits {
  max_tool_rounds: number;
  max_session_tokens: number | null;
}

export type MultiagentMember =
  | { type: "self" }
  | { type: "agent"; id: string; version: number | null }
  | { type: "advisor"; model: string; instructions: string | null };

export interface MultiagentConfig {
  type: "coordinator";
  agents: MultiagentMember[];
}

export interface AgentManifest {
  schema: string;
  model: string;
  system: string;
  tools: Toolset[];
  mcp_servers: McpServer[];
  skills: SkillRef[];
  multiagent: MultiagentConfig | null;
  runtime: RuntimeLimits;
  metadata: Record<string, unknown>;
}

export interface AgentRecord {
  id: string;
  tenant_id: string;
  slug: string;
  display_name: string;
  description?: string | null;
  latest_version: number;
  status: "active" | "disabled";
  lifecycle: "draft" | "published" | "recalled";
  origin: "enterprise" | "employee";
  assignment_keys: string[];
  worker_keys: string[];
  default_environment_id?: string | null;
}

export interface AgentVersionRecord {
  agent_id: string;
  version: number;
  manifest: Record<string, unknown>;
  manifest_hash: string;
  created_by?: string | null;
  created_at: string;
  note?: string | null;
}

export interface CloudEnvironmentConfig {
  type: "cloud";
  sandbox_backend: "subprocess" | "docker" | "remote";
  image?: string | null;
  egress_allow_domains: string[];
  idle_ttl_seconds: number;
}

export interface DesktopWorkerEnvironmentConfig {
  type: "desktop_worker";
  worker_keys: string[];
}

export type EnvironmentConfig = CloudEnvironmentConfig | DesktopWorkerEnvironmentConfig;

export interface EnvironmentRecord {
  id: string;
  tenant_id: string;
  name: string;
  type: EnvironmentType;
  config: EnvironmentConfig;
  status: "active" | "disabled";
}

export interface SessionRecord {
  id: string;
  tenant_id: string;
  agent_id: string;
  agent_version: number;
  environment_id?: string | null;
  created_by_user_id?: string | null;
  source: SessionSource;
  status: SessionStatus;
  stop_reason?: StopReason | null;
  title?: string | null;
  vault_ids: string[];
  resources: Record<string, unknown>[];
  usage: Usage;
  created_at: string;
  updated_at: string;
  archived_at?: string | null;
}

export interface WorkItemRecord {
  id: string;
  session_id: string;
  environment_id: string;
  status: WorkItemStatus;
  claimed_by_device?: string | null;
  lease_expires_at?: string | null;
  attempts: number;
  last_heartbeat_at?: string | null;
}

export interface ManifestResult {
  ok: boolean;
  errors: string[];
  normalized: Record<string, unknown> | null;
  manifestHash: string | null;
}

const TOP_LEVEL_KEYS = [
  "schema",
  "model",
  "system",
  "tools",
  "mcp_servers",
  "skills",
  "multiagent",
  "runtime",
  "metadata",
] as const;
const SYSTEM_MANAGED_METADATA_KEYS = ["model", "description", "agentName"] as const;
const TOOL_TYPES = ["agx_builtin", "mcp", "custom"] as const;
const TOOL_POLICIES = ["always_allow", "always_ask"] as const;
const MCP_TRANSPORTS = ["http", "sse"] as const;
const MCP_TRANSPORT_ALIASES: Record<string, string> = {
  "streamable-http": "http",
  streamable_http: "http",
};
const SKILL_SOURCES = ["builtin", "tenant"] as const;
const MODEL_RE = /^[^/\s]+\/\S+$/;
const MULTIAGENT_TYPES = ["coordinator"] as const;
const MULTIAGENT_MEMBER_TYPES = ["self", "agent", "advisor"] as const;
const MEMBER_AGENT_ID_RE = /^[A-Za-z0-9._-]{1,64}$/;
const CUSTOM_TOOL_NAME_RE = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;
const DEFAULT_MAX_TOOL_ROUNDS = 40;
const IMAGE_MEDIA_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"] as const;
const EVENT_BASE_KEYS = ["id", "session_id", "seq", "thread_id", "created_at", "processed_at"] as const;
const CLIENT_EVENT_TYPE_SET: ReadonlySet<string> = new Set(CLIENT_EVENT_TYPES);
const SERVER_EVENT_TYPE_SET: ReadonlySet<string> = new Set(SERVER_EVENT_TYPES);

type ManifestToolType = (typeof TOOL_TYPES)[number];

export function isClientEventType(value: string): value is ClientEventType {
  return CLIENT_EVENT_TYPE_SET.has(value);
}

export function isServerEventType(value: string): value is ServerEventType {
  return SERVER_EVENT_TYPE_SET.has(value);
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

export function manifestHash(normalized: Record<string, unknown>): string {
  const digest = createHash("sha256").update(canonicalJson(normalized), "utf8").digest("hex");
  return `sha256:${digest}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function utf8Length(value: string): number {
  return new TextEncoder().encode(value).length;
}

function jsonLiteral(value: unknown): string {
  return JSON.stringify(value);
}

function includesValue(options: readonly string[], value: unknown): boolean {
  return typeof value === "string" && options.includes(value);
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => sortValue(item));
  }
  if (!isRecord(value)) {
    return value;
  }
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(value).sort()) {
    sorted[key] = sortValue(value[key]);
  }
  return sorted;
}

function failure(errors: string[]): ManifestResult {
  return {
    ok: false,
    errors: [...errors].sort(),
    normalized: null,
    manifestHash: null,
  };
}

function declaredMcpServers(raw: Record<string, unknown>): Set<string> | null {
  if (!Array.isArray(raw.mcp_servers)) {
    return null;
  }
  const names = new Set<string>();
  for (const server of raw.mcp_servers) {
    if (!isRecord(server)) continue;
    if (isNonEmptyString(server.name)) {
      names.add(server.name);
    }
  }
  return names;
}

function validateConfig(
  errors: string[],
  toolIndex: number,
  configIndex: number,
  config: unknown,
  seenNames: Set<string>,
): void {
  const prefix = `manifest.tools[${toolIndex}].configs[${configIndex}]`;
  if (!isRecord(config)) {
    errors.push(`${prefix}: must be an object`);
    return;
  }
  for (const key of Object.keys(config)) {
    if (key !== "name" && key !== "policy" && key !== "enabled") {
      errors.push(`${prefix}.${key}: unknown field`);
    }
  }
  const name = config.name;
  if (!isNonEmptyString(name)) {
    errors.push(`${prefix}.name: is required`);
  } else if (seenNames.has(name)) {
    errors.push(`${prefix}.name: duplicate tool "${name}"`);
  } else {
    seenNames.add(name);
  }
  if (
    "policy" in config &&
    config.policy !== null &&
    !includesValue(TOOL_POLICIES, config.policy)
  ) {
    errors.push(`${prefix}.policy: must be one of [always_allow,always_ask]`);
  }
  if ("enabled" in config && typeof config.enabled !== "boolean") {
    errors.push(`${prefix}.enabled: must be a boolean`);
  }
}

function validateToolConfigs(errors: string[], toolIndex: number, item: Record<string, unknown>): void {
  if (!("configs" in item)) return;
  const configs = item.configs;
  if (!Array.isArray(configs)) {
    errors.push(`manifest.tools[${toolIndex}].configs: must be an array`);
    return;
  }
  const seenNames = new Set<string>();
  for (let configIndex = 0; configIndex < configs.length; configIndex += 1) {
    validateConfig(errors, toolIndex, configIndex, configs[configIndex], seenNames);
  }
}

function validateDefaultPolicy(errors: string[], toolIndex: number, item: Record<string, unknown>): void {
  if (!("default_policy" in item)) return;
  if (!includesValue(TOOL_POLICIES, item.default_policy)) {
    errors.push(
      `manifest.tools[${toolIndex}].default_policy: must be one of [always_allow,always_ask]`,
    );
  }
}

function validateBuiltinOrMcp(
  errors: string[],
  toolIndex: number,
  item: Record<string, unknown>,
  allowedKeys: readonly string[],
): void {
  for (const key of Object.keys(item)) {
    if (!allowedKeys.includes(key)) {
      errors.push(`manifest.tools[${toolIndex}].${key}: unknown field`);
    }
  }
  validateDefaultPolicy(errors, toolIndex, item);
  validateToolConfigs(errors, toolIndex, item);
}

function validateMcpServerRef(
  errors: string[],
  toolIndex: number,
  item: Record<string, unknown>,
  declaredServers: Set<string> | null,
  seenMcpServers: Set<string>,
): void {
  const server = item.server;
  if (!isNonEmptyString(server)) {
    errors.push(`manifest.tools[${toolIndex}].server: is required`);
    return;
  }
  if (declaredServers !== null && !declaredServers.has(server)) {
    errors.push(
      `manifest.tools[${toolIndex}].server: references undeclared mcp server "${server}"`,
    );
  }
  if (seenMcpServers.has(server)) {
    errors.push(
      `manifest.tools[${toolIndex}].server: duplicate toolset for mcp server "${server}"`,
    );
  } else {
    seenMcpServers.add(server);
  }
}

function validateCustomTool(
  errors: string[],
  toolIndex: number,
  item: Record<string, unknown>,
  seenCustom: Set<string>,
): void {
  for (const key of Object.keys(item)) {
    if (key !== "type" && key !== "name" && key !== "description" && key !== "input_schema") {
      errors.push(`manifest.tools[${toolIndex}].${key}: unknown field`);
    }
  }
  const name = item.name;
  if (typeof name !== "string" || !CUSTOM_TOOL_NAME_RE.test(name)) {
    errors.push(
      `manifest.tools[${toolIndex}].name: must match ^[A-Za-z][A-Za-z0-9_]{0,63}$`,
    );
  }
  if (typeof name === "string") {
    if (seenCustom.has(name)) {
      errors.push(`manifest.tools[${toolIndex}].name: duplicate custom tool "${name}"`);
    } else {
      seenCustom.add(name);
    }
  }
  if (!isNonEmptyString(item.description)) {
    errors.push(`manifest.tools[${toolIndex}].description: is required`);
  }
  if (!isRecord(item.input_schema)) {
    errors.push(`manifest.tools[${toolIndex}].input_schema: must be an object`);
  }
}

function isToolType(value: unknown): value is ManifestToolType {
  return includesValue(TOOL_TYPES, value);
}

function validateToolItem(
  errors: string[],
  index: number,
  item: Record<string, unknown>,
  declaredServers: Set<string> | null,
  seenBuiltin: { value: boolean },
  seenMcpServers: Set<string>,
  seenCustom: Set<string>,
): void {
  if (!isToolType(item.type)) {
    const rendered = "type" in item ? jsonLiteral(item.type) : "null";
    errors.push(
      `manifest.tools[${index}].type: must be one of [agx_builtin,mcp,custom], got ${rendered}`,
    );
    return;
  }
  const toolType = item.type;
  switch (toolType) {
    case "agx_builtin":
      validateBuiltinOrMcp(errors, index, item, ["type", "default_policy", "configs"]);
      if (seenBuiltin.value) {
        errors.push(`manifest.tools[${index}].type: duplicate agx_builtin toolset`);
      } else {
        seenBuiltin.value = true;
      }
      return;
    case "mcp":
      validateBuiltinOrMcp(errors, index, item, ["type", "server", "default_policy", "configs"]);
      validateMcpServerRef(errors, index, item, declaredServers, seenMcpServers);
      return;
    case "custom":
      validateCustomTool(errors, index, item, seenCustom);
      return;
    default: {
      const _exhaustive: never = toolType;
      return _exhaustive;
    }
  }
}

function validateTools(
  raw: Record<string, unknown>,
  errors: string[],
  declaredServers: Set<string> | null,
): void {
  if (!("tools" in raw)) return;
  const tools = raw.tools;
  if (!Array.isArray(tools)) {
    errors.push("manifest.tools: must be an array");
    return;
  }
  const seenBuiltin = { value: false };
  const seenMcpServers = new Set<string>();
  const seenCustom = new Set<string>();
  for (let index = 0; index < tools.length; index += 1) {
    const item = tools[index];
    if (!isRecord(item)) {
      errors.push(`manifest.tools[${index}]: must be an object`);
      continue;
    }
    validateToolItem(errors, index, item, declaredServers, seenBuiltin, seenMcpServers, seenCustom);
  }
}

function normalizedTransport(value: unknown): unknown {
  if (typeof value !== "string") return value;
  return MCP_TRANSPORT_ALIASES[value] ?? value;
}

function validateMcpServers(raw: Record<string, unknown>, errors: string[]): void {
  if (!("mcp_servers" in raw)) return;
  const servers = raw.mcp_servers;
  if (!Array.isArray(servers)) {
    errors.push("manifest.mcp_servers: must be an array");
    return;
  }
  const seenNames = new Set<string>();
  const allowed = ["name", "url", "transport", "headers", "env"];
  for (let index = 0; index < servers.length; index += 1) {
    const server = servers[index];
    const prefix = `manifest.mcp_servers[${index}]`;
    if (!isRecord(server)) {
      errors.push(`${prefix}: must be an object`);
      continue;
    }
    for (const key of Object.keys(server)) {
      if (key === "headers" || key === "env") {
        errors.push(`${prefix}.${key}: secrets are not allowed in manifest`);
      } else if (!allowed.includes(key)) {
        errors.push(`${prefix}.${key}: unknown field`);
      }
    }
    const name = server.name;
    if (!isNonEmptyString(name)) {
      errors.push(`${prefix}.name: is required`);
    } else if (seenNames.has(name)) {
      errors.push(`${prefix}.name: duplicate mcp server "${name}"`);
    } else {
      seenNames.add(name);
    }
    const url = server.url;
    if (!isNonEmptyString(url)) {
      errors.push(`${prefix}.url: is required`);
    } else if (!url.startsWith("https://") && !url.startsWith("http://")) {
      errors.push(`${prefix}.url: must start with http:// or https://`);
    }
    if ("transport" in server) {
      const transport = normalizedTransport(server.transport);
      if (!includesValue(MCP_TRANSPORTS, transport)) {
        errors.push(`${prefix}.transport: must be one of [http,sse]`);
      }
    }
  }
}

function validateSkills(raw: Record<string, unknown>, errors: string[]): void {
  if (!("skills" in raw)) return;
  const skills = raw.skills;
  if (!Array.isArray(skills)) {
    errors.push("manifest.skills: must be an array");
    return;
  }
  for (let index = 0; index < skills.length; index += 1) {
    const skill = skills[index];
    const prefix = `manifest.skills[${index}]`;
    if (!isRecord(skill)) {
      errors.push(`${prefix}: must be an object`);
      continue;
    }
    for (const key of Object.keys(skill)) {
      if (key !== "source" && key !== "id" && key !== "version") {
        errors.push(`${prefix}.${key}: unknown field`);
      }
    }
    if (!includesValue(SKILL_SOURCES, skill.source)) {
      errors.push(`${prefix}.source: must be one of [builtin,tenant]`);
    }
    if (!isNonEmptyString(skill.id)) {
      errors.push(`${prefix}.id: is required`);
    }
    if ("version" in skill && skill.version !== null && !isNonEmptyString(skill.version)) {
      errors.push(`${prefix}.version: must be a string`);
    }
  }
}

function validateRuntime(raw: Record<string, unknown>, errors: string[]): void {
  if (!("runtime" in raw)) return;
  const runtime = raw.runtime;
  if (!isRecord(runtime)) {
    errors.push("manifest.runtime: must be an object");
    return;
  }
  for (const key of Object.keys(runtime)) {
    if (key !== "max_tool_rounds" && key !== "max_session_tokens") {
      errors.push(`manifest.runtime.${key}: unknown field`);
    }
  }
  if ("max_tool_rounds" in runtime) {
    const rounds = runtime.max_tool_rounds;
    if (!isInteger(rounds) || rounds < 1 || rounds > 500) {
      errors.push("manifest.runtime.max_tool_rounds: must be an integer between 1 and 500");
    }
  }
  if ("max_session_tokens" in runtime && runtime.max_session_tokens !== null) {
    const tokens = runtime.max_session_tokens;
    if (!isInteger(tokens) || tokens < 1000) {
      errors.push("manifest.runtime.max_session_tokens: must be null or an integer >= 1000");
    }
  }
}

function isMemberKind(value: unknown): value is "self" | "agent" | "advisor" {
  return typeof value === "string" && (MULTIAGENT_MEMBER_TYPES as readonly string[]).includes(value);
}

function validateMultiagent(raw: Record<string, unknown>, errors: string[]): void {
  if (!("multiagent" in raw) || raw.multiagent === null) return;
  const value = raw.multiagent;
  if (!isRecord(value)) {
    errors.push("manifest.multiagent: must be null or an object");
    return;
  }
  for (const key of Object.keys(value)) {
    if (key !== "type" && key !== "agents") {
      errors.push(`manifest.multiagent.${key}: unknown field`);
    }
  }
  if (!(MULTIAGENT_TYPES as readonly string[]).includes(String(value.type))) {
    errors.push('manifest.multiagent.type: must be "coordinator"');
  }
  if (!("agents" in value) || !Array.isArray(value.agents)) {
    errors.push("manifest.multiagent.agents: must be an array");
    return;
  }
  const agents = value.agents;
  if (agents.length === 0 || agents.length > MULTIAGENT_MAX_MEMBERS) {
    errors.push("manifest.multiagent.agents: must contain 1-20 items");
    return;
  }
  let seenSelf = false;
  let seenAdvisor = false;
  const seenAgentIds = new Set<string>();
  let hasDelegate = false;
  for (let index = 0; index < agents.length; index += 1) {
    const item = agents[index];
    const prefix = `manifest.multiagent.agents[${index}]`;
    if (!isRecord(item)) {
      errors.push(`${prefix}: must be an object`);
      continue;
    }
    const kind = item.type;
    if (!isMemberKind(kind)) {
      errors.push(`${prefix}.type: must be one of [self,agent,advisor], got ${jsonLiteral(kind ?? null)}`);
      continue;
    }
    if (kind === "self" || kind === "agent") hasDelegate = true;
    switch (kind) {
      case "self": {
        for (const key of Object.keys(item)) {
          if (key !== "type") errors.push(`${prefix}.${key}: unknown field`);
        }
        if (seenSelf) errors.push(`${prefix}.type: duplicate self entry`);
        else seenSelf = true;
        break;
      }
      case "agent": {
        for (const key of Object.keys(item)) {
          if (key !== "type" && key !== "id" && key !== "version") {
            errors.push(`${prefix}.${key}: unknown field`);
          }
        }
        const agentId = item.id;
        if (!("id" in item) || !isNonEmptyString(agentId)) {
          errors.push(`${prefix}.id: is required`);
        } else if (!MEMBER_AGENT_ID_RE.test(agentId)) {
          errors.push(`${prefix}.id: must match ^[A-Za-z0-9._-]{1,64}$`);
        } else if (seenAgentIds.has(agentId)) {
          errors.push(`${prefix}.id: duplicate agent "${agentId}"`);
        } else {
          seenAgentIds.add(agentId);
        }
        if ("version" in item && item.version !== null) {
          const version = item.version;
          if (!isInteger(version) || version < 1) {
            errors.push(`${prefix}.version: must be null or an integer >= 1`);
          }
        }
        break;
      }
      case "advisor": {
        for (const key of Object.keys(item)) {
          if (key !== "type" && key !== "model" && key !== "instructions") {
            errors.push(`${prefix}.${key}: unknown field`);
          }
        }
        const model = item.model;
        if (!("model" in item)) {
          errors.push(`${prefix}.model: is required`);
        } else if (typeof model !== "string" || !MODEL_RE.test(model)) {
          errors.push(`${prefix}.model: must be "<providerId>/<modelName>"`);
        }
        if ("instructions" in item && item.instructions !== null) {
          const instructions = item.instructions;
          if (typeof instructions !== "string") {
            errors.push(`${prefix}.instructions: must be a string`);
          } else if (utf8Length(instructions) > MAX_ADVISOR_INSTRUCTIONS_BYTES) {
            errors.push(`${prefix}.instructions: exceeds 8192 bytes`);
          }
        }
        if (seenAdvisor) errors.push(`${prefix}.type: duplicate advisor entry`);
        else seenAdvisor = true;
        break;
      }
      default: {
        const _exhaustive: never = kind;
        errors.push(`${prefix}.type: must be one of [self,agent,advisor], got ${jsonLiteral(_exhaustive)}`);
      }
    }
  }
  if (!hasDelegate) {
    errors.push("manifest.multiagent.agents: must include at least one self or agent entry");
  }
}

function normalizeMultiagent(value: unknown): Record<string, unknown> | null {
  if (value == null) return null;
  if (!isRecord(value) || !Array.isArray(value.agents)) return null;
  const members: Record<string, unknown>[] = [];
  for (const item of value.agents) {
    if (!isRecord(item)) continue;
    if (item.type === "self") {
      members.push({ type: "self" });
    } else if (item.type === "agent") {
      members.push({
        type: "agent",
        id: item.id,
        version: "version" in item ? item.version : null,
      });
    } else {
      members.push({
        type: "advisor",
        model: item.model,
        instructions: "instructions" in item ? item.instructions : null,
      });
    }
  }
  return { type: "coordinator", agents: members };
}

function collectErrors(raw: Record<string, unknown>): string[] {
  const errors: string[] = [];
  for (const key of Object.keys(raw)) {
    if (!includesValue(TOP_LEVEL_KEYS, key)) {
      errors.push(`manifest.${key}: unknown field`);
    }
  }
  if (raw.schema !== MANIFEST_SCHEMA) {
    errors.push('manifest.schema: must be "agx.agent/v1"');
  }
  if (!("model" in raw)) {
    errors.push("manifest.model: is required");
  } else if (typeof raw.model !== "string" || !MODEL_RE.test(raw.model)) {
    errors.push('manifest.model: must be "<providerId>/<modelName>"');
  }
  if ("system" in raw) {
    const system = raw.system;
    if (typeof system !== "string") {
      errors.push("manifest.system: must be a string");
    } else if (utf8Length(system) > MAX_SYSTEM_BYTES) {
      errors.push("manifest.system: exceeds 65536 bytes");
    }
  }
  const declared = declaredMcpServers(raw);
  validateTools(raw, errors, declared);
  validateMcpServers(raw, errors);
  validateSkills(raw, errors);
  validateMultiagent(raw, errors);
  validateRuntime(raw, errors);
  if ("metadata" in raw && !isRecord(raw.metadata)) {
    errors.push("manifest.metadata: must be an object");
  }
  return errors;
}

function normalizeConfig(config: Record<string, unknown>): Record<string, unknown> {
  return {
    name: config.name,
    policy: "policy" in config ? config.policy : null,
    enabled: "enabled" in config ? config.enabled : true,
  };
}

function normalizeToolConfigs(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord).map((config) => normalizeConfig(config));
}

function normalizeManifestRecord(raw: Record<string, unknown>): Record<string, unknown> {
  const tools: Record<string, unknown>[] = [];
  const toolsIn = Array.isArray(raw.tools) ? raw.tools : [];
  for (const item of toolsIn) {
    if (!isRecord(item)) continue;
    if (item.type === "agx_builtin") {
      tools.push({
        type: "agx_builtin",
        default_policy: "default_policy" in item ? item.default_policy : "always_allow",
        configs: normalizeToolConfigs(item.configs),
      });
    } else if (item.type === "mcp") {
      tools.push({
        type: "mcp",
        server: item.server,
        default_policy: "default_policy" in item ? item.default_policy : "always_allow",
        configs: normalizeToolConfigs(item.configs),
      });
    } else {
      tools.push({
        type: "custom",
        name: item.name,
        description: item.description,
        input_schema: isRecord(item.input_schema) ? { ...item.input_schema } : {},
      });
    }
  }

  const mcpServers = (Array.isArray(raw.mcp_servers) ? raw.mcp_servers : [])
    .filter(isRecord)
    .map((server) => ({
      name: server.name,
      url: server.url,
      transport: "transport" in server ? (normalizedTransport(server.transport) as string) : "http",
    }));

  const skills = (Array.isArray(raw.skills) ? raw.skills : []).filter(isRecord).map((skill) => ({
    source: skill.source,
    id: skill.id,
    version: "version" in skill ? skill.version : null,
  }));

  const runtimeIn = isRecord(raw.runtime) ? raw.runtime : {};
  const metadata: Record<string, unknown> = isRecord(raw.metadata) ? { ...raw.metadata } : {};
  for (const key of SYSTEM_MANAGED_METADATA_KEYS) {
    delete metadata[key];
  }

  return {
    schema: raw.schema,
    model: raw.model,
    system: "system" in raw ? raw.system : "",
    tools,
    mcp_servers: mcpServers,
    skills,
    multiagent: normalizeMultiagent(raw.multiagent),
    runtime: {
      max_tool_rounds:
        "max_tool_rounds" in runtimeIn ? runtimeIn.max_tool_rounds : DEFAULT_MAX_TOOL_ROUNDS,
      max_session_tokens: "max_session_tokens" in runtimeIn ? runtimeIn.max_session_tokens : null,
    },
    metadata,
  };
}

export function validateManifest(raw: unknown): ManifestResult {
  if (!isRecord(raw)) {
    return failure(["manifest: must be a JSON object"]);
  }
  if (utf8Length(JSON.stringify(raw)) > MAX_MANIFEST_BYTES) {
    return failure(["manifest: exceeds 262144 bytes"]);
  }
  const errors = collectErrors(raw);
  if (errors.length > 0) {
    return failure(errors);
  }
  const normalized = normalizeManifestRecord(raw);
  return {
    ok: true,
    errors: [],
    normalized,
    manifestHash: manifestHash(normalized),
  };
}

function keysAllowed(obj: Record<string, unknown>, specific: readonly string[]): boolean {
  const allowed = new Set<string>([...specific, ...EVENT_BASE_KEYS]);
  return Object.keys(obj).every((key) => allowed.has(key));
}

function keysExact(obj: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(obj).every((key) => allowed.includes(key));
}

function optionalString(obj: Record<string, unknown>, key: string): boolean {
  if (!(key in obj)) return true;
  const value = obj[key];
  return value === null || typeof value === "string";
}

function optionalInt(obj: Record<string, unknown>, key: string): boolean {
  if (!(key in obj)) return true;
  const value = obj[key];
  return value === null || isInteger(value);
}

function eventBaseOk(obj: Record<string, unknown>): boolean {
  return (
    optionalString(obj, "id") &&
    optionalString(obj, "session_id") &&
    optionalInt(obj, "seq") &&
    optionalString(obj, "thread_id") &&
    optionalString(obj, "created_at") &&
    optionalString(obj, "processed_at")
  );
}

function validateImageSource(source: unknown): boolean {
  if (!isRecord(source) || typeof source.type !== "string") return false;
  const sourceType = source.type;
  if (sourceType !== "base64" && sourceType !== "url" && sourceType !== "file") return false;
  switch (sourceType) {
    case "base64":
      return (
        keysExact(source, ["type", "media_type", "data"]) &&
        includesValue(IMAGE_MEDIA_TYPES, source.media_type) &&
        typeof source.data === "string"
      );
    case "url":
      return (
        keysExact(source, ["type", "url"]) &&
        typeof source.url === "string" &&
        source.url.startsWith("https://")
      );
    case "file":
      return keysExact(source, ["type", "file_id"]) && typeof source.file_id === "string";
    default: {
      const _exhaustive: never = sourceType;
      return _exhaustive;
    }
  }
}

function validateDocSource(source: unknown): boolean {
  if (!isRecord(source) || typeof source.type !== "string") return false;
  const sourceType = source.type;
  if (sourceType !== "text" && sourceType !== "file") return false;
  switch (sourceType) {
    case "text":
      return keysExact(source, ["type", "text"]) && typeof source.text === "string";
    case "file":
      return keysExact(source, ["type", "file_id"]) && typeof source.file_id === "string";
    default: {
      const _exhaustive: never = sourceType;
      return _exhaustive;
    }
  }
}

function validateContentBlock(block: unknown): boolean {
  if (!isRecord(block) || typeof block.type !== "string") return false;
  const blockType = block.type;
  if (blockType !== "text" && blockType !== "image" && blockType !== "document") return false;
  switch (blockType) {
    case "text":
      return keysExact(block, ["type", "text"]) && typeof block.text === "string";
    case "image":
      return keysExact(block, ["type", "source"]) && validateImageSource(block.source);
    case "document":
      if (!keysExact(block, ["type", "source", "title"])) return false;
      if ("title" in block && block.title !== null && typeof block.title !== "string") return false;
      return validateDocSource(block.source);
    default: {
      const _exhaustive: never = blockType;
      return _exhaustive;
    }
  }
}

function validateContentList(value: unknown, minLength: number): boolean {
  if (!Array.isArray(value) || value.length < minLength) return false;
  return value.every((item) => validateContentBlock(item));
}

function validateClientEvent(raw: unknown): raw is ClientEvent {
  if (!isRecord(raw) || typeof raw.type !== "string" || !isClientEventType(raw.type)) return false;
  if (!eventBaseOk(raw)) return false;
  const eventType = raw.type;
  switch (eventType) {
    case "user.message":
      return keysAllowed(raw, ["type", "content"]) && validateContentList(raw.content, 1);
    case "user.interrupt":
      return keysAllowed(raw, ["type"]);
    case "user.tool_confirmation":
      if (!keysAllowed(raw, ["type", "tool_use_id", "result", "deny_message"])) return false;
      if (typeof raw.tool_use_id !== "string" || raw.tool_use_id.length < 1) return false;
      if (raw.result !== "allow" && raw.result !== "deny") return false;
      if (
        "deny_message" in raw &&
        raw.deny_message !== null &&
        typeof raw.deny_message !== "string"
      ) {
        return false;
      }
      if (raw.result === "allow" && raw.deny_message != null) return false;
      return true;
    case "user.custom_tool_result":
      if (!keysAllowed(raw, ["type", "custom_tool_use_id", "content", "is_error"])) return false;
      if (typeof raw.custom_tool_use_id !== "string" || raw.custom_tool_use_id.length < 1) {
        return false;
      }
      if ("content" in raw && !validateContentList(raw.content, 0)) return false;
      if ("is_error" in raw && typeof raw.is_error !== "boolean") return false;
      return true;
    default: {
      const _exhaustive: never = eventType;
      return _exhaustive;
    }
  }
}

export function validateClientEventBatch(
  raw: unknown,
): { ok: true; events: ClientEvent[] } | { ok: false; code: MAErrorCode; index: number | null } {
  if (!isRecord(raw) || !("events" in raw) || !Array.isArray(raw.events)) {
    return { ok: false, code: "invalid_event_batch", index: null };
  }
  const events = raw.events;
  if (events.length === 0 || events.length > MAX_EVENTS_PER_BATCH) {
    return { ok: false, code: "invalid_event_batch", index: null };
  }
  const parsed: ClientEvent[] = [];
  const seenConfirmations = new Set<string>();
  const seenCustomResults = new Set<string>();
  for (let index = 0; index < events.length; index += 1) {
    const item = events[index];
    if (!validateClientEvent(item)) {
      return { ok: false, code: "invalid_event_batch", index };
    }
    switch (item.type) {
      case "user.message":
      case "user.interrupt":
        parsed.push(item);
        break;
      case "user.tool_confirmation":
        if (seenConfirmations.has(item.tool_use_id)) {
          return { ok: false, code: "duplicate_resolution", index };
        }
        seenConfirmations.add(item.tool_use_id);
        parsed.push(item);
        break;
      case "user.custom_tool_result":
        if (seenCustomResults.has(item.custom_tool_use_id)) {
          return { ok: false, code: "duplicate_resolution", index };
        }
        seenCustomResults.add(item.custom_tool_use_id);
        parsed.push(item);
        break;
      default: {
        const _exhaustive: never = item;
        return { ok: false, code: "invalid_event_batch", index: _exhaustive };
      }
    }
  }
  return { ok: true, events: parsed };
}
