import { NextResponse } from "next/server";

import { requireAdminScope } from "../../../../../lib/admin-auth";
import { loadAgentNames, maSessionErrorResponse } from "../shared";

export const dynamic = "force-dynamic";

export async function GET() {
  const guard = await requireAdminScope(["audit:read:all"]);
  if (!guard.ok) return guard.response;
  try {
    const names = await loadAgentNames(guard.session.tenantId);
    const agents = [...names.entries()]
      .map(([id, agent]) => ({ id, displayName: agent.displayName, slug: agent.slug }))
      .sort((a, b) => a.displayName.localeCompare(b.displayName, "zh"));
    return NextResponse.json({ code: "00000", message: "ok", data: { agents } });
  } catch (error) {
    return maSessionErrorResponse(error);
  }
}
