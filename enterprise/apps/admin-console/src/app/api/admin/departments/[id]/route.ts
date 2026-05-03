import { deleteDepartment, getDepartment, moveDepartment, updateDepartmentName } from "@agenticx/iam-core";
import { NextResponse } from "next/server";
import { requireAdminScope } from "../../../../../lib/admin-auth";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminScope(["dept:read"]);
  if (!auth.ok) return auth.response;
  const { id } = await context.params;
  const row = await getDepartment(auth.session.tenantId, id);
  if (!row) return NextResponse.json({ code: "40400", message: "not found" }, { status: 404 });
  return NextResponse.json({ code: "00000", message: "ok", data: { department: row } });
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminScope(["dept:update"]);
  if (!auth.ok) return auth.response;
  const { id } = await context.params;
  try {
    const body = (await request.json()) as { name?: string; parentId?: string | null };
    const current = await getDepartment(auth.session.tenantId, id);
    if (!current) return NextResponse.json({ code: "40400", message: "not found" }, { status: 404 });

    let row = current;
    if (body.parentId !== undefined && body.parentId !== current.parentId) {
      row = await moveDepartment({
        tenantId: auth.session.tenantId,
        id,
        newParentId: body.parentId,
        actorUserId: auth.session.userId,
      });
    }
    if (typeof body.name === "string" && body.name.trim() && body.name.trim() !== row.name) {
      row = await updateDepartmentName({
        tenantId: auth.session.tenantId,
        id,
        name: body.name,
        actorUserId: auth.session.userId,
      });
    }
    return NextResponse.json({ code: "00000", message: "ok", data: { department: row } });
  } catch (error) {
    return NextResponse.json(
      { code: "40000", message: error instanceof Error ? error.message : "invalid request" },
      { status: 400 }
    );
  }
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminScope(["dept:delete"]);
  if (!auth.ok) return auth.response;
  const { id } = await context.params;
  try {
    await deleteDepartment({ tenantId: auth.session.tenantId, id, actorUserId: auth.session.userId });
    return NextResponse.json({ code: "00000", message: "ok" });
  } catch (error) {
    const err = error as Error & { code?: string };
    if (err.message === "dept_has_children" || err.message === "dept_has_members") {
      return NextResponse.json({ code: "40900", message: err.message }, { status: 409 });
    }
    return NextResponse.json(
      { code: "40000", message: error instanceof Error ? error.message : "invalid request" },
      { status: 400 }
    );
  }
}
