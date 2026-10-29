import { NextResponse } from "next/server";
import { requireAdminScope } from "../../../../../lib/admin-auth";
import { getRule, listExecutions } from "../../../../../lib/rules-store";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await requireAdminScope(["provider:read"]);
  if (!auth.ok) return auth.response;
  try {
    const { id } = await context.params;
    const rule = await getRule(id);
    if (!rule) {
      return NextResponse.json({ code: "40400", message: "rule not found" }, { status: 404 });
    }
    const executions = await listExecutions(id);
    return NextResponse.json({
      code: "00000",
      message: "ok",
      data: { rule, executions },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "failed to load rule";
    return NextResponse.json({ code: "50000", message }, { status: 500 });
  }
}
