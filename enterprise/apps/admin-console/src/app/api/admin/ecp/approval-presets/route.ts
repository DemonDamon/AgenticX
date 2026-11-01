import { NextResponse } from "next/server";

import { requireAdminScope } from "../../../../../lib/admin-auth";
import { listBuiltinPresets } from "../../../../../lib/ecp-approval-store";

export async function GET() {
  const auth = await requireAdminScope(["provider:read"]);
  if (!auth.ok) return auth.response;
  const presets = await listBuiltinPresets();
  return NextResponse.json({ code: "00000", message: "ok", data: { presets } });
}
