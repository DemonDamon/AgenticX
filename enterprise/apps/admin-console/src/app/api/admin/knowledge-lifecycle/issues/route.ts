import { NextResponse } from "next/server";
import { requireAdminScope } from "../../../../../lib/admin-auth";
import { listIssues, type IssueStatus } from "../../../../../lib/knowledge-lifecycle-store";

export async function GET(request: Request) {
  const auth = await requireAdminScope(["provider:read"]);
  if (!auth.ok) return auth.response;
  try {
    const url = new URL(request.url);
    const objectId = url.searchParams.get("object_id") || undefined;
    const status = (url.searchParams.get("status") || undefined) as IssueStatus | undefined;
    const issues = await listIssues({ objectId, status });
    return NextResponse.json({ code: "00000", message: "ok", data: { issues } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "failed to load issues";
    return NextResponse.json({ code: "50000", message }, { status: 500 });
  }
}
