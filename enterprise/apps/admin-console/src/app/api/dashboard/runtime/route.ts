import { listAgents, listAdminUsers } from "@agenticx/iam-core";
import { NextResponse } from "next/server";

import { requireAdminScope } from "../../../../lib/admin-auth";
import { listRecentAgentSpans } from "../../../../lib/agent-trace-store";
import { buildRuntimeDashboard, type RuntimeDashboardQuery } from "../../../../lib/runtime-dashboard";

function sourceOf(value: string | null): RuntimeDashboardQuery["source"] {
  if (value === "desktop" || value === "web") return value;
  return "";
}

export async function GET(request: Request) {
  const guard = await requireAdminScope(["metering:read"]);
  if (!guard.ok) return guard.response;

  const url = new URL(request.url);
  const query: RuntimeDashboardQuery = {
    userId: url.searchParams.get("user_id")?.trim() || undefined,
    agentId: url.searchParams.get("agent_id")?.trim() || undefined,
    model: url.searchParams.get("model")?.trim() || undefined,
    service: url.searchParams.get("service")?.trim() || undefined,
    source: sourceOf(url.searchParams.get("source")),
  };

  try {
    const spans = await listRecentAgentSpans(2000);
    let agents: Awaited<ReturnType<typeof listAgents>> = [];
    let users: Array<{ id: string; displayName: string }> = [];
    try {
      agents = await listAgents(guard.session.tenantId);
    } catch {
      agents = [];
    }
    try {
      const listed = await listAdminUsers(guard.session.tenantId, { limit: 200 });
      users = listed.items.map((user) => ({ id: user.id, displayName: user.displayName }));
    } catch {
      users = [];
    }
    const data = buildRuntimeDashboard(
      spans.map((span) => ({
        trace_id: span.trace_id,
        step_kind: span.step_kind,
        status: span.status,
        model: span.model,
        provider: span.provider,
        input_tokens: span.input_tokens,
        output_tokens: span.output_tokens,
        total_tokens: span.total_tokens,
        duration_ms: span.duration_ms,
        created_at: span.created_at.toISOString(),
        metadata: span.metadata,
      })),
      agents.map((agent) => ({
        id: agent.id,
        slug: agent.slug,
        displayName: agent.displayName,
        localAvatarId: agent.localAvatarId,
        status: agent.status,
      })),
      users,
      query,
      Date.now(),
    );
    return NextResponse.json({ code: "00000", message: "ok", data });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ code: "50001", message }, { status: 500 });
  }
}
