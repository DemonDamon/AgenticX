import { getDepartment } from "@agenticx/iam-core";
import { NextResponse } from "next/server";
import { requireAdminScope } from "../../../../../../lib/admin-auth";
import { getDeptModels, setDeptModels } from "../../../../../../lib/dept-models-store";

export async function GET(_req: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminScope(["dept:read"]);
  if (!auth.ok) return auth.response;
  const { id } = await context.params;
  const dept = await getDepartment(auth.session.tenantId, id);
  if (!dept) {
    return NextResponse.json({ code: "40400", message: "department not found" }, { status: 404 });
  }
  return NextResponse.json({
    code: "00000",
    message: "ok",
    data: { deptId: id, modelIds: await getDeptModels(id) },
  });
}

export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminScope(["dept:update"]);
  if (!auth.ok) return auth.response;
  const { id } = await context.params;
  const dept = await getDepartment(auth.session.tenantId, id);
  if (!dept) {
    return NextResponse.json({ code: "40400", message: "department not found" }, { status: 404 });
  }
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const raw = Array.isArray(body.modelIds) ? body.modelIds : [];
    const modelIds = raw.filter((x): x is string => typeof x === "string");
    const saved = await setDeptModels(id, modelIds);
    return NextResponse.json({ code: "00000", message: "ok", data: { deptId: id, modelIds: saved } });
  } catch (error) {
    return NextResponse.json(
      { code: "40000", message: error instanceof Error ? error.message : "invalid request" },
      { status: 400 },
    );
  }
}
