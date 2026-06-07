import { NextResponse } from "next/server";
import { requireAdminScope } from "../../../../../../lib/admin-auth";
import {
  assignPlanToScope,
  cancelPlanAssignment,
  listPlanAssignments,
  type PlanScopeType,
} from "../../../../../../lib/quota-plans-store";

type RouteParams = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: RouteParams) {
  const guard = await requireAdminScope(["metering:read"]);
  if (!guard.ok) return guard.response;
  const { id } = await params;
  const assignments = await listPlanAssignments(id);
  return NextResponse.json({ code: "00000", message: "ok", data: { assignments } });
}

export async function POST(request: Request, { params }: RouteParams) {
  const guard = await requireAdminScope(["metering:manage"]);
  if (!guard.ok) return guard.response;
  const { id } = await params;
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ code: "40001", message: "invalid json" }, { status: 400 });
  }
  const action = String(body.action ?? "assign");
  if (action === "cancel") {
    const assignmentId = String(body.assignmentId ?? body.assignment_id ?? "").trim();
    if (!assignmentId) {
      return NextResponse.json({ code: "40002", message: "assignmentId is required" }, { status: 400 });
    }
    await cancelPlanAssignment(assignmentId);
    return NextResponse.json({ code: "00000", message: "ok", data: { cancelled: true } });
  }

  try {
    const scopeType = String(body.scopeType ?? body.scope_type ?? "") as PlanScopeType;
    const scopeId = String(body.scopeId ?? body.scope_id ?? "").trim();
    const effectiveNextPeriod = Boolean(body.effectiveNextPeriod ?? body.effective_next_period);
    const assignment = await assignPlanToScope({
      planId: id,
      scopeType,
      scopeId,
      effectiveNextPeriod,
    });
    return NextResponse.json({ code: "00000", message: "ok", data: { assignment } });
  } catch (err) {
    const message = err instanceof Error ? err.message : "assign failed";
    return NextResponse.json({ code: "40002", message }, { status: 400 });
  }
}
