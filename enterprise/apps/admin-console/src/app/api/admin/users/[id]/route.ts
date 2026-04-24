import { NextResponse } from "next/server";
import { requireAdminSession } from "../../../../../lib/admin-auth";
import {
  deleteUser,
  getUser,
  updateUser,
  type AdminUserStatus,
  type UpdateUserInput,
} from "../../../../../lib/users-store";

function isStatus(value: unknown): value is AdminUserStatus {
  return value === "active" || value === "disabled" || value === "locked";
}

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminSession();
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  const user = getUser(id);
  if (!user) {
    return NextResponse.json({ code: "40400", message: "user not found" }, { status: 404 });
  }
  return NextResponse.json({ code: "00000", message: "ok", data: { user } });
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminSession();
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const patch: UpdateUserInput = {};
    if (typeof body.displayName === "string") patch.displayName = body.displayName;
    if (body.deptId === null || typeof body.deptId === "string") patch.deptId = body.deptId;
    if (isStatus(body.status)) patch.status = body.status;
    if (Array.isArray(body.scopes) && body.scopes.every((item): item is string => typeof item === "string")) {
      patch.scopes = body.scopes;
    }
    const updated = updateUser(id, patch);
    return NextResponse.json({ code: "00000", message: "ok", data: { user: updated } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "invalid request";
    const status = message === "user not found" ? 404 : 400;
    return NextResponse.json({ code: status === 404 ? "40400" : "40000", message }, { status });
  }
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminSession();
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  const ok = deleteUser(id);
  if (!ok) {
    return NextResponse.json({ code: "40400", message: "user not found" }, { status: 404 });
  }
  return NextResponse.json({ code: "00000", message: "ok" });
}
