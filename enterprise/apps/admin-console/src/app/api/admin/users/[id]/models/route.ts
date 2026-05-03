import { getAdminUser } from "@agenticx/iam-core";
import { NextResponse } from "next/server";
import { requireAdminScope } from "../../../../../../lib/admin-auth";
import { getUserModels, setUserModels } from "../../../../../../lib/user-models-store";

export async function GET(_req: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminScope(["user:read"]);
  if (!auth.ok) return auth.response;
  const { id } = await context.params;
  const user = await getAdminUser(auth.session.tenantId, id);
  if (!user) {
    return NextResponse.json({ code: "40400", message: "user not found" }, { status: 404 });
  }
  return NextResponse.json({
    code: "00000",
    message: "ok",
    data: { userId: id, modelIds: getUserModels(id) },
  });
}

export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminScope(["user:update"]);
  if (!auth.ok) return auth.response;
  const { id } = await context.params;
  const user = await getAdminUser(auth.session.tenantId, id);
  if (!user) {
    return NextResponse.json({ code: "40400", message: "user not found" }, { status: 404 });
  }
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const raw = Array.isArray(body.modelIds) ? body.modelIds : [];
    const modelIds = raw.filter((x): x is string => typeof x === "string");
    const saved = setUserModels(id, modelIds);
    setUserModels(`email:${user.email.toLowerCase()}`, modelIds);
    return NextResponse.json({ code: "00000", message: "ok", data: { userId: id, modelIds: saved } });
  } catch (error) {
    return NextResponse.json(
      { code: "40000", message: error instanceof Error ? error.message : "invalid request" },
      { status: 400 }
    );
  }
}
