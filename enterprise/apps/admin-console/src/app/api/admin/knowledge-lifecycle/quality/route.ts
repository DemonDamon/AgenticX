import { NextResponse } from "next/server";
import { requireAdminScope } from "../../../../../lib/admin-auth";
import { runQualityAndOpenIssues } from "../../../../../lib/knowledge-lifecycle-store";

export async function POST() {
  const auth = await requireAdminScope(["provider:update"]);
  if (!auth.ok) return auth.response;
  try {
    const result = await runQualityAndOpenIssues();
    return NextResponse.json({
      code: "00000",
      message: "ok",
      data: { findings: result.findings, opened: result.opened },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "quality run failed";
    return NextResponse.json({ code: "50000", message }, { status: 500 });
  }
}
