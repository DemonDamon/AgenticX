import { NextResponse } from "next/server";
import { requireAdminScope } from "../../../../../../lib/admin-auth";
import {
  getObject,
  listIssues,
  listTrail,
} from "../../../../../../lib/knowledge-lifecycle-store";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await requireAdminScope(["provider:read"]);
  if (!auth.ok) return auth.response;
  try {
    const { id } = await context.params;
    const object = await getObject(id);
    if (!object) {
      return NextResponse.json({ code: "40400", message: "object not found" }, { status: 404 });
    }
    const issues = await listIssues({ objectId: id });
    const trail = await listTrail(id);
    return NextResponse.json({
      code: "00000",
      message: "ok",
      data: { object, issues, trail },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "failed to load object";
    return NextResponse.json({ code: "50000", message }, { status: 500 });
  }
}
