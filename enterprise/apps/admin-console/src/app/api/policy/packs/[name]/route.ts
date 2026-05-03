import { NextResponse } from "next/server";
import { requireAdminScope } from "../../../../../lib/admin-auth";
import { setPolicyPackEnabled } from "../../../../../lib/policy-store";

export async function PATCH(request: Request, context: { params: Promise<{ name: string }> }) {
  const guard = await requireAdminScope(["policy:update"]);
  if (!guard.ok) return guard.response;
  const { name } = await context.params;
  let body: { enabled?: boolean };
  try {
    body = (await request.json()) as { enabled?: boolean };
  } catch {
    return NextResponse.json({ code: "40001", message: "invalid json" }, { status: 400 });
  }
  if (typeof body.enabled !== "boolean") {
    return NextResponse.json({ code: "40002", message: "enabled must be boolean" }, { status: 400 });
  }
  try {
    const packs = setPolicyPackEnabled(name, body.enabled);
    return NextResponse.json({ code: "00000", message: "ok", data: { packs } });
  } catch (error) {
    return NextResponse.json(
      { code: "40003", message: error instanceof Error ? error.message : String(error) },
      { status: 400 }
    );
  }
}
