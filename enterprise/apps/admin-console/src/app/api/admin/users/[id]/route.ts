import {
  getAdminUser,
  softDeleteUser,
  updateAdminUser,
  type AdminUserStatus,
  type UpdateAdminUserInput,
} from "@agenticx/iam-core";
import { NextResponse } from "next/server";
import { requireAdminScope } from "../../../../../lib/admin-auth";
import { getDefaultOrgId } from "../../../../../lib/admin-pg-auth";

function isStatus(value: unknown): value is AdminUserStatus {
  return value === "active" || value === "disabled" || value === "locked";
}

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminScope(["user:read"]);
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  const user = await getAdminUser(auth.session.tenantId, id);
  if (!user) {
    return NextResponse.json({ code: "40400", message: "user not found" }, { status: 404 });
  }
  return NextResponse.json({ code: "00000", message: "ok", data: { user } });
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminScope(["user:update"]);
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const patch: UpdateAdminUserInput = {};
    if (typeof body.displayName === "string") patch.displayName = body.displayName;
    if (body.deptId === null || typeof body.deptId === "string") patch.deptId = body.deptId;
    if (isStatus(body.status)) patch.status = body.status;
    if (typeof body.phone === "string") patch.phone = body.phone;
    if (typeof body.employeeNo === "string") patch.employeeNo = body.employeeNo;
    if (typeof body.jobTitle === "string") patch.jobTitle = body.jobTitle;
    if (Array.isArray(body.roleCodes) && body.roleCodes.every((item): item is string => typeof item === "string")) {
      patch.roleCodes = body.roleCodes;
    }
    const defaultOrgId = await getDefaultOrgId(auth.session.tenantId);
    const updated = await updateAdminUser(auth.session.tenantId, id, patch, {
      actorUserId: auth.session.userId,
      defaultOrgId,
    });
    return NextResponse.json({ code: "00000", message: "ok", data: { user: updated } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "invalid request";
    const status = message === "user not found" ? 404 : 400;
    return NextResponse.json({ code: status === 404 ? "40400" : "40000", message }, { status });
  }
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminScope(["user:delete"]);
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  try {
    await softDeleteUser(auth.session.tenantId, id, auth.session.userId);
    return NextResponse.json({ code: "00000", message: "ok" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "invalid request";
    return NextResponse.json({ code: "40000", message }, { status: 400 });
  }
}
