import { NextResponse } from "next/server";

import { resolveDesktopIdentity } from "../../../../lib/desktop-auth";

const KINDS = new Set([
  "confirm_resolved",
  "policy_denied",
  "effect_intercepted",
  "external_effect",
]);

const STRING_FIELDS = [
  "ts",
  "session_id",
  "agent_id",
  "tool_name",
  "subject",
  "outcome",
  "decision_source",
  "risk",
  "args_digest",
  "summary",
] as const;

const EVENT_ID_RE = /^[0-9a-f]{32}$/;

function gatewayBase(): string {
  const explicit = process.env.GATEWAY_BASE_URL?.trim();
  if (explicit) return explicit.replace(/\/+$/, "");
  try {
    return new URL(process.env.GATEWAY_COMPLETIONS_URL ?? "http://127.0.0.1:8088/v1/chat/completions").origin;
  } catch {
    return "http://127.0.0.1:8088";
  }
}

function eventError(event: unknown): string | null {
  if (!event || typeof event !== "object" || Array.isArray(event)) {
    return "event must be an object";
  }
  const row = event as Record<string, unknown>;
  if (row.v !== 1) return "v must be 1";
  if (typeof row.event_id !== "string" || !EVENT_ID_RE.test(row.event_id)) {
    return "event_id must be 32 lowercase hex characters";
  }
  if (typeof row.kind !== "string" || !KINDS.has(row.kind)) {
    return "kind is invalid";
  }
  for (const field of STRING_FIELDS) {
    const value = row[field];
    if (typeof value !== "string") return `${field} must be a string`;
    const max = field === "summary" ? 200 : 256;
    if (value.length > max) return `${field} exceeds ${max} characters`;
  }
  return null;
}

export async function POST(request: Request) {
  const identity = await resolveDesktopIdentity(request);
  if (!identity) {
    return NextResponse.json(
      { code: "40101", message: "企业登录已失效，请重新登录" },
      { status: 401 },
    );
  }
  if (!identity.scopes.includes("desktop:managed")) {
    return NextResponse.json(
      { code: "40301", message: "缺少 desktop:managed 权限" },
      { status: 403 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ code: "40001", message: "invalid json" }, { status: 400 });
  }
  const events = (body as { events?: unknown } | null)?.events;
  if (!Array.isArray(events) || events.length < 1 || events.length > 200) {
    return NextResponse.json(
      { code: "40001", message: "events must contain 1 to 200 items" },
      { status: 400 },
    );
  }
  for (let index = 0; index < events.length; index += 1) {
    const reason = eventError(events[index]);
    if (reason) {
      return NextResponse.json(
        { code: "40001", index, message: reason },
        { status: 400 },
      );
    }
  }

  const authorization = request.headers.get("authorization") ?? request.headers.get("Authorization") ?? "";
  let response: Response;
  try {
    response = await fetch(`${gatewayBase()}/v1/desktop/action-audit`, {
      method: "POST",
      headers: {
        authorization,
        "content-type": "application/json",
      },
      body: JSON.stringify({ events }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    return NextResponse.json(
      { code: "50201", message: "gateway unreachable" },
      { status: 502 },
    );
  }

  const text = await response.text();
  if (!response.ok) {
    let message = text || response.statusText;
    try {
      const parsed = JSON.parse(text) as { message?: unknown; error?: { message?: unknown } | string };
      if (typeof parsed.message === "string" && parsed.message) {
        message = parsed.message;
      } else if (parsed.error && typeof parsed.error === "object" && typeof parsed.error.message === "string") {
        message = parsed.error.message;
      } else if (typeof parsed.error === "string" && parsed.error) {
        message = parsed.error;
      }
    } catch {
      /* keep the raw body */
    }
    return NextResponse.json(
      { code: String(response.status), message },
      { status: response.status },
    );
  }

  let accepted = events.length;
  try {
    const parsed = JSON.parse(text) as { accepted?: unknown };
    if (typeof parsed.accepted === "number") accepted = parsed.accepted;
  } catch {
    /* gateway 2xx without a JSON body still counts the batch */
  }
  return NextResponse.json({ code: "00000", data: { accepted } });
}
