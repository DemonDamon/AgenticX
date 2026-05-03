import { getRoleById, listUsersForRole } from "@agenticx/iam-core";
import { NextResponse } from "next/server";
import { requireAdminScope } from "../../../../../../lib/admin-auth";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminScope(["role:read"]);
  if (!auth.ok) return auth.response;
  const { id } = await context.params;
  const role = await getRoleById(auth.session.tenantId, id);
  if (!role) return NextResponse.json({ code: "40400", message: "not found" }, { status: 404 });
  const usersRaw = await listUsersForRole(auth.session.tenantId, id);
  const users = usersRaw.map((u) => ({ id: u.userId, email: u.email, displayName: u.displayName }));
  return NextResponse.json({ code: "00000", message: "ok", data: { role, users } });
}
