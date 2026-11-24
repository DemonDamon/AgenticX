import { deleteRole, getRoleById, listUsersForRole, updateRole } from "@agenticx/iam-core";
import { NextResponse } from "next/server";
import { requireAdminScope } from "../../../../../lib/admin-auth";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminScope(["role:update"]);
  if (!auth.ok) return auth.response;
  const { id } = await context.params;
  try {
    const body = (await request.json()) as { name?: string; scopes?: string[] };
    const scopes = Array.isArray(body.scopes) ? body.scopes.filter((s): s is string => typeof s === "string") : undefined;
    const role = await updateRole({
      tenantId: auth.session.tenantId,
      id,
      name: body.name,
      scopes,
      actorUserId: auth.session.userId,
      actor: { kind: "user", tenantId: auth.session.tenantId, userId: auth.session.userId, scopes: auth.scopes },
    });
    return NextResponse.json({ code: "00000", message: "ok", data: { role } });
  } catch (error) {
    return NextResponse.json(
      { code: error instanceof Error && error.name === "PrivilegeEscalationError" ? "40300" : "40000", message: error instanceof Error ? error.message : "invalid request" },
      { status: error instanceof Error && error.name === "PrivilegeEscalationError" ? 403 : 400 }
    );
  }
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminScope(["role:delete"]);
  if (!auth.ok) return auth.response;
  const { id } = await context.params;
  try {
    await deleteRole({ tenantId: auth.session.tenantId, id, actorUserId: auth.session.userId, actor: { kind: "user", tenantId: auth.session.tenantId, userId: auth.session.userId, scopes: auth.scopes }, });
    return NextResponse.json({ code: "00000", message: "ok" });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "invalid request";
    const status = msg === "role_in_use" ? 409 : error instanceof Error && error.name === "PrivilegeEscalationError" ? 403 : 400;
    return NextResponse.json({ code: status === 409 ? "40900" : status === 403 ? "40300" : "40000", message: msg }, { status });
  }
}
