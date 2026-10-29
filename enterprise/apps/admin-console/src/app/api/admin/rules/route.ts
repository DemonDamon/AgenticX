import { NextResponse } from "next/server";
import { requireAdminScope } from "../../../../lib/admin-auth";
import { listRules } from "../../../../lib/rules-store";

export async function GET() {
  const auth = await requireAdminScope(["provider:read"]);
  if (!auth.ok) return auth.response;
  try {
    const rules = await listRules();
    return NextResponse.json({ code: "00000", message: "ok", data: { rules } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "failed to load rules";
    return NextResponse.json({ code: "50000", message }, { status: 500 });
  }
}
