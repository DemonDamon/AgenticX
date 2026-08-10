import { enqueueLog } from "./db-sink";

export type LogLevel = "debug" | "info" | "warn" | "error";

export type LogFields = {
  event: string; // 稳定事件名，如 "chat.completions.gateway_unreachable"
  trace_id?: string;
  user_id?: string;
  tenant_id?: string;
  session_id?: string;
  route?: string;
  status?: number;
  duration_ms?: number;
  error_name?: string;
  error_message?: string;
  error_stack?: string;
  [key: string]: unknown;
};

const STRUCTURED_KEYS = new Set([
  "event",
  "trace_id",
  "user_id",
  "tenant_id",
  "session_id",
  "route",
  "status",
  "duration_ms",
  "error_name",
  "error_message",
  "error_stack",
]);

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

const SENSITIVE_KEY_NEEDLES = [
  "messages",
  "content",
  "prompt",
  "authorization",
  "cookie",
  "token",
  "api_key",
  "apikey",
  "password",
  "secret",
  "refresh",
] as const;

function minLevel(): LogLevel {
  const raw = (process.env.PORTAL_LOG_LEVEL ?? "info").trim().toLowerCase();
  if (raw === "debug" || raw === "info" || raw === "warn" || raw === "error") {
    return raw;
  }
  return "info";
}

function isSensitiveKey(key: string): boolean {
  const lower = key.toLowerCase();
  return SENSITIVE_KEY_NEEDLES.some((needle) => lower.includes(needle));
}

function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return value.slice(0, max);
}

function redactValue(key: string, value: unknown): unknown {
  if (isSensitiveKey(key)) {
    return "[redacted]";
  }
  if (key === "error_message" && typeof value === "string") {
    return truncate(value, 500);
  }
  if (key === "error_stack" && typeof value === "string") {
    return truncate(value, 2000);
  }
  if (Array.isArray(value)) {
    return value.map((item, index) => redactValue(String(index), item));
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [childKey, childValue] of Object.entries(value as Record<string, unknown>)) {
      out[childKey] = redactValue(childKey, childValue);
    }
    return out;
  }
  return value;
}

export function redact(fields: LogFields): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    out[key] = redactValue(key, value);
  }
  return out;
}

export function log(level: LogLevel, fields: LogFields): void {
  if (LEVEL_ORDER[level] < LEVEL_ORDER[minLevel()]) {
    return;
  }
  const safe = redact(fields);
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    ...safe,
  });
  // stdout first — DB sink is best-effort and must not block or break logging.
  if (level === "error") {
    console.error(line);
  } else {
    console.log(line);
  }

  const extras: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(safe)) {
    if (!STRUCTURED_KEYS.has(key)) extras[key] = value;
  }
  enqueueLog({
    tenant_id: typeof safe.tenant_id === "string" && safe.tenant_id.trim() ? safe.tenant_id : "unknown",
    log_time: new Date(),
    level,
    event: String(safe.event ?? "unknown"),
    trace_id: typeof safe.trace_id === "string" ? safe.trace_id : undefined,
    user_id: typeof safe.user_id === "string" ? safe.user_id : undefined,
    session_id: typeof safe.session_id === "string" ? safe.session_id : undefined,
    route: typeof safe.route === "string" ? safe.route : undefined,
    status: typeof safe.status === "number" ? safe.status : undefined,
    duration_ms: typeof safe.duration_ms === "number" ? safe.duration_ms : undefined,
    error_name: typeof safe.error_name === "string" ? safe.error_name : undefined,
    error_message: typeof safe.error_message === "string" ? safe.error_message : undefined,
    error_stack: typeof safe.error_stack === "string" ? safe.error_stack : undefined,
    fields: Object.keys(extras).length > 0 ? extras : undefined,
  });
}
