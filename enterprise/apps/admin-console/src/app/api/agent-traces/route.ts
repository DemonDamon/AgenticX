import { NextResponse } from "next/server";
import { getAgentTrace, listAgentTraceIds } from "../../../../lib/agent-trace-store";
import { requireAdminScope } from "../../../../lib/admin-auth";

export async function GET(request: Request) {
  const guard = await requireAdminScope(["metering:read"]);
  if (!guard.ok) return guard.response;

  const url = new URL(request.url);
  const traceId = url.searchParams.get("trace_id")?.trim();
  try {
    if (traceId) {
      const trace = await getAgentTrace(traceId);
      if (!trace) {
        return NextResponse.json({ code: "40401", message: "trace not found" }, { status: 404 });
      }
      return NextResponse.json({ code: "00000", message: "ok", data: trace });
    }
    const limit = Number(url.searchParams.get("limit") ?? "50");
    const ids = await listAgentTraceIds(Number.isFinite(limit) ? limit : 50);
    return NextResponse.json({ code: "00000", message: "ok", data: { trace_ids: ids } });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ code: "50001", message }, { status: 500 });
  }
}
