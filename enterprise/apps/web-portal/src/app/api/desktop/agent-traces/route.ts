import { NextResponse } from "next/server";

import { insertDesktopAgentTraces, type DesktopTraceSpan } from "../../../../lib/desktop-agent-traces";
import { resolveDesktopIdentity } from "../../../../lib/desktop-auth";

const TRACE_ID_RE = /^near:[A-Za-z0-9._:-]{1,120}$/;
const STEP_KINDS = new Set(["model", "tool", "subagent", "run"]);
const STATUSES = new Set(["ok", "error", "cancelled"]);
const INT_FIELDS = [
  "input_tokens",
  "output_tokens",
  "reasoning_tokens",
  "total_tokens",
  "duration_ms",
  "cost_usd",
] as const;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function nonNegativeInt(value: unknown, field: string): string | null {
  if (value === undefined) return null;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    return `${field} must be a non-negative integer`;
  }
  return null;
}

function spanError(span: unknown): string | null {
  if (!isPlainObject(span)) return "span must be an object";
  if (typeof span.trace_id !== "string" || !TRACE_ID_RE.test(span.trace_id)) {
    return "trace_id must match ^near:[A-Za-z0-9._:-]{1,120}$";
  }
  if (typeof span.step_no !== "number" || !Number.isInteger(span.step_no) || span.step_no < 1) {
    return "step_no must be a positive integer";
  }
  if (typeof span.step_kind !== "string" || !STEP_KINDS.has(span.step_kind)) {
    return "step_kind is invalid";
  }
  if (typeof span.status !== "string" || !STATUSES.has(span.status)) {
    return "status is invalid";
  }
  for (const field of INT_FIELDS) {
    const reason = nonNegativeInt(span[field], field);
    if (reason) return reason;
  }
  if (span.model != null) {
    if (typeof span.model !== "string") return "model must be a string";
    if (span.model.length > 128) return "model exceeds 128 characters";
  }
  if (span.provider != null) {
    if (typeof span.provider !== "string") return "provider must be a string";
    if (span.provider.length > 64) return "provider exceeds 64 characters";
  }
  if (span.error_message != null) {
    if (typeof span.error_message !== "string") return "error_message must be a string";
    if (span.error_message.length > 2000) return "error_message exceeds 2000 characters";
  }
  if (span.metadata != null && !isPlainObject(span.metadata)) {
    return "metadata must be an object";
  }
  return null;
}

function asSpan(span: Record<string, unknown>, userId: string): DesktopTraceSpan {
  const metadata = isPlainObject(span.metadata) ? span.metadata : {};
  const model = typeof span.model === "string" ? span.model : undefined;
  const provider = typeof span.provider === "string" ? span.provider : undefined;
  const errorMessage = typeof span.error_message === "string" ? span.error_message : undefined;
  return {
    trace_id: String(span.trace_id),
    step_no: Number(span.step_no),
    step_kind: span.step_kind as DesktopTraceSpan["step_kind"],
    status: span.status as DesktopTraceSpan["status"],
    model,
    provider,
    input_tokens: typeof span.input_tokens === "number" ? span.input_tokens : 0,
    output_tokens: typeof span.output_tokens === "number" ? span.output_tokens : 0,
    reasoning_tokens: typeof span.reasoning_tokens === "number" ? span.reasoning_tokens : 0,
    total_tokens: typeof span.total_tokens === "number" ? span.total_tokens : 0,
    duration_ms: typeof span.duration_ms === "number" ? span.duration_ms : 0,
    cost_usd: typeof span.cost_usd === "number" ? span.cost_usd : 0,
    error_message: errorMessage,
    metadata: {
      ...metadata,
      user_id: userId,
      source: "near",
    },
  };
}

export async function POST(request: Request) {
  const identity = await resolveDesktopIdentity(request);
  if (!identity) {
    return NextResponse.json(
      { code: "40101", message: "企业登录已失效，请重新登录" },
      { status: 401 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ code: "40001", message: "invalid json" }, { status: 400 });
  }

  const spans = isPlainObject(body) ? body.spans : undefined;
  if (!Array.isArray(spans) || spans.length < 1 || spans.length > 200) {
    return NextResponse.json(
      { code: "40001", message: "spans must contain 1 to 200 items" },
      { status: 400 },
    );
  }

  const prepared: DesktopTraceSpan[] = [];
  for (let index = 0; index < spans.length; index += 1) {
    const reason = spanError(spans[index]);
    if (reason) {
      return NextResponse.json({ code: "40001", index, message: reason }, { status: 400 });
    }
    prepared.push(asSpan(spans[index] as Record<string, unknown>, identity.userId));
  }

  try {
    const accepted = await insertDesktopAgentTraces({
      tenantId: identity.tenantId,
      userId: identity.userId,
      spans: prepared,
    });
    return NextResponse.json({ code: "00000", data: { accepted } });
  } catch {
    return NextResponse.json(
      { code: "50001", message: "failed to store traces" },
      { status: 500 },
    );
  }
}
