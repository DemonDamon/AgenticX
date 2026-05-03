import {
  createDepartment,
  deleteDepartment,
  getDefaultOrgId,
  getDepartment,
  listDepartmentsFlat,
  listDepartmentsTree,
  moveDepartment,
  updateDepartmentName,
} from "@agenticx/iam-core";
import { NextResponse } from "next/server";
import { requireAdminScope } from "../../../../lib/admin-auth";

export async function GET(request: Request) {
  const auth = await requireAdminScope(["dept:read"]);
  if (!auth.ok) return auth.response;
  const { searchParams } = new URL(request.url);
  const shape = searchParams.get("shape") ?? "tree";
  if (shape === "flat") {
    const data = await listDepartmentsFlat(auth.session.tenantId);
    return NextResponse.json({ code: "00000", message: "ok", data: { shape: "flat", items: data } });
  }
  const data = await listDepartmentsTree(auth.session.tenantId);
  return NextResponse.json({ code: "00000", message: "ok", data: { shape: "tree", items: data } });
}

export async function POST(request: Request) {
  const auth = await requireAdminScope(["dept:create"]);
  if (!auth.ok) return auth.response;
  try {
    const body = (await request.json()) as { name?: string; parentId?: string | null };
    const name = typeof body.name === "string" ? body.name : "";
    const parentId = body.parentId === undefined ? null : body.parentId;
    const orgId = await getDefaultOrgId(auth.session.tenantId);
    if (!orgId) {
      return NextResponse.json({ code: "40000", message: "no organization for tenant" }, { status: 400 });
    }
    const created = await createDepartment({
      tenantId: auth.session.tenantId,
      orgId,
      name,
      parentId,
      actorUserId: auth.session.userId,
    });
    return NextResponse.json({ code: "00000", message: "ok", data: { department: created } });
  } catch (error) {
    return NextResponse.json(
      { code: "40000", message: error instanceof Error ? error.message : "invalid request" },
      { status: 400 }
    );
  }
}
