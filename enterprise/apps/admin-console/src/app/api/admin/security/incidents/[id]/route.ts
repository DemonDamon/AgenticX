import { NextResponse } from "next/server";

import {
  getSecurityIncident,
  updateSecurityIncidentStatus,
  type SecurityIncidentStatus,
} from "@agenticx/iam-core";

import { requireAdminScope } from "../../../../../../lib/admin-auth";
import { insertAuditEvent } from "@agenticx/iam-core";
import { listIncidentActionsFor } from "../../../../../../lib/incident-response";

export const runtime = "nodejs";

/**
 * SP5 incident-response：事件详情与三态流转
 * （open→handling、handling→resolved[必填结案说明]、resolved→handling 重开）。
 */
type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: Request, ctx: RouteContext) {
  const auth = await requireAdminScope(["provider:read"]);
  if (!auth.ok) return auth.response;
  const { id } = await ctx.params;
  const incident = await getSecurityIncident(auth.session.tenantId, id);
  if (!incident) {
    return NextResponse.json({ code: "40401", message: "incident not found" }, { status: 404 });
  }
  const actions = await listIncidentActionsFor(auth.session.tenantId, id);
  return NextResponse.json({ code: "00000", message: "ok", data: { incident, actions } });
}

export async function PATCH(request: Request, ctx: RouteContext) {
  const auth = await requireAdminScope(["provider:update"]);
  if (!auth.ok) return auth.response;
  const { id } = await ctx.params;
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ code: "40001", message: "invalid json" }, { status: 400 });
  }
  const rawStatus = typeof body.status === "string" ? body.status : "";
  if (!["open", "handling", "resolved"].includes(rawStatus)) {
    return NextResponse.json({ code: "40001", message: "invalid status" }, { status: 400 });
  }
  const status = rawStatus as SecurityIncidentStatus;
  const resolutionNote =
    typeof body.resolutionNote === "string" && body.resolutionNote.trim()
      ? body.resolutionNote.trim().slice(0, 4000)
      : null;
  // 先审计后流转。
  await insertAuditEvent({
    tenantId: auth.session.tenantId,
    actorUserId: auth.session.userId,
    eventType: "incident_status_changed",
    targetKind: "security_incident",
    targetId: id,
    detail: { status, resolution_note: resolutionNote },
  });
  try {
    const incident = await updateSecurityIncidentStatus({
      tenantId: auth.session.tenantId,
      incidentId: id,
      status,
      resolutionNote,
    });
    if (!incident) {
      return NextResponse.json({ code: "40401", message: "incident not found" }, { status: 404 });
    }
    return NextResponse.json({ code: "00000", message: "ok", data: incident });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ code: "40002", message }, { status: 400 });
  }
}
