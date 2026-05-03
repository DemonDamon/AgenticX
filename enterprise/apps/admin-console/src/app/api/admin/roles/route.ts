import {
  createCustomRole,
  deleteRole,
  duplicateRole,
  ensureSystemRoles,
  listRoles,
  updateRole,
} from "@agenticx/iam-core";
import { NextResponse } from "next/server";
import { requireAdminScope } from "../../../../lib/admin-auth";

export async function GET() {
  const auth = await requireAdminScope(["role:read"]);
  if (!auth.ok) return auth.response;
  await ensureSystemRoles(auth.session.tenantId);
  const items = await listRoles(auth.session.tenantId);
  return NextResponse.json({ code: "00000", message: "ok", data: { items } });
}

export async function POST(request: Request) {
  const auth = await requireAdminScope(["role:create"]);
  if (!auth.ok) return auth.response;
  try {
    const body = (await request.json()) as {
      mode?: string;
      sourceId?: string;
      code?: string;
      name?: string;
      scopes?: string[];
      newCode?: string;
      newName?: string;
    };
    await ensureSystemRoles(auth.session.tenantId);
    if (body.mode === "duplicate" && body.sourceId && body.newCode && body.newName) {
      const role = await duplicateRole({
        tenantId: auth.session.tenantId,
        sourceId: body.sourceId,
        newCode: body.newCode,
        newName: body.newName,
        actorUserId: auth.session.userId,
      });
      return NextResponse.json({ code: "00000", message: "ok", data: { role } });
    }
    const code = typeof body.code === "string" ? body.code : "";
    const name = typeof body.name === "string" ? body.name : "";
    const scopes = Array.isArray(body.scopes) ? body.scopes.filter((s): s is string => typeof s === "string") : [];
    const role = await createCustomRole({
      tenantId: auth.session.tenantId,
      code,
      name,
      scopes,
      actorUserId: auth.session.userId,
    });
    return NextResponse.json({ code: "00000", message: "ok", data: { role } });
  } catch (error) {
    return NextResponse.json(
      { code: "40000", message: error instanceof Error ? error.message : "invalid request" },
      { status: 400 }
    );
  }
}
