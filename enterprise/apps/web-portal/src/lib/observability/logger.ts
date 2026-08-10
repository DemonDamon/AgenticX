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
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    ...redact(fields),
  });
  if (level === "error") {
    console.error(line);
  } else {
    console.log(line);
  }
}
