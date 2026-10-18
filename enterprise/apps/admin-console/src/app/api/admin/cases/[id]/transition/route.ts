import { NextResponse } from "next/server";
import { isCaseStatus } from "@agenticx/db-schema";
import { CaseNotFoundError, CaseTransitionError, transitionEnterpriseCase } from "@agenticx/iam-core";
import { requireAdminScope } from "../../../../../../lib/admin-auth";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminScope(["provider:update"]);
  if (!auth.ok) return auth.response;
  const { id } = await context.params;
  const body = (await request.json()) as { status?: string };
  const status = String(body.status ?? "");
  if (!isCaseStatus(status)) {
    return NextResponse.json({ code: "40000", message: "unknown status" }, { status: 400 });
  }
  try {
    const item = await transitionEnterpriseCase(auth.session.tenantId, id, status);
    return NextResponse.json({ code: "00000", message: "ok", data: { case: item } });
  } catch (error) {
    if (error instanceof CaseNotFoundError) {
      return NextResponse.json({ code: "40400", message: error.message }, { status: 404 });
    }
    if (error instanceof CaseTransitionError) {
      return NextResponse.json({ code: "40000", message: error.message }, { status: 400 });
    }
    const message = error instanceof Error ? error.message : "transition failed";
    return NextResponse.json({ code: "50000", message }, { status: 500 });
  }
}
