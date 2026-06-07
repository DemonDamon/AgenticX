import { NextResponse } from "next/server";
import { ingestAgentTraceSpans } from "../../../../lib/agent-trace-store";
import { requireAdminScope } from "../../../../lib/admin-auth";

export async function POST(request: Request) {
  const guard = await requireAdminScope(["metering:manage"]);
  if (!guard.ok) return guard.response;

  let body: { spans?: unknown };
  try {
    body = (await request.json()) as { spans?: unknown };
  } catch {
    return NextResponse.json({ code: "40001", message: "invalid json" }, { status: 400 });
  }
  if (!Array.isArray(body.spans) || body.spans.length === 0) {
    return NextResponse.json({ code: "40002", message: "spans required" }, { status: 400 });
  }

  const spans = body.spans
    .filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null)
    .map((item) => ({
      id: typeof item.id === "string" ? item.id : undefined,
      trace_id: String(item.trace_id ?? ""),
      step_no: Number(item.step_no ?? 0),
      step_kind: String(item.step_kind ?? "model"),
      status: String(item.status ?? "ok"),
      model: typeof item.model === "string" ? item.model : null,
      provider: typeof item.provider === "string" ? item.provider : null,
      input_tokens: Number(item.input_tokens ?? 0),
      output_tokens: Number(item.output_tokens ?? 0),
      reasoning_tokens: Number(item.reasoning_tokens ?? 0),
      total_tokens: Number(item.total_tokens ?? 0),
      cost_usd: Number(item.cost_usd ?? 0),
      duration_ms: Number(item.duration_ms ?? 0),
      error_message: typeof item.error_message === "string" ? item.error_message : null,
      metadata: typeof item.metadata === "object" && item.metadata !== null ? (item.metadata as Record<string, unknown>) : null,
    }))
    .filter((span) => span.trace_id.length > 0 && span.step_no > 0);

  if (spans.length === 0) {
    return NextResponse.json({ code: "40003", message: "no valid spans" }, { status: 400 });
  }

  try {
    await ingestAgentTraceSpans(spans);
    return NextResponse.json({ code: "00000", message: "ok", data: { ingested: spans.length } });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ code: "50001", message }, { status: 500 });
  }
}
