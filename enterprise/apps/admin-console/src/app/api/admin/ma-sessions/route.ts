import { NextResponse } from "next/server";
import { listMaSessions, loadAuthUserByEmail, type ListMaSessionsFilter } from "@agenticx/iam-core";

import { parseListQuery } from "../../../../lib/ma-session-console";
import { requireAdminScope } from "../../../../lib/admin-auth";
import { loadAgentNames, loadUserBriefs, maSessionErrorResponse, toPublicSession } from "./shared";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const guard = await requireAdminScope(["audit:read:all"]);
  if (!guard.ok) return guard.response;
  try {
    const parsed = parseListQuery(new URL(request.url).searchParams, new Date());
    const tenantId = guard.session.tenantId;
    let userId: string | undefined;
    if (parsed.userEmail) {
      const user = await loadAuthUserByEmail(tenantId, parsed.userEmail.trim().toLowerCase());
      if (!user) {
        return NextResponse.json({ code: "00000", message: "ok", data: { items: [], nextBeforeId: null } });
      }
      userId = user.id;
    }
    const filter: ListMaSessionsFilter = { limit: parsed.limit };
    if (parsed.agentId) filter.agentId = parsed.agentId;
    if (userId) filter.userId = userId;
    if (parsed.status) filter.status = parsed.status;
    if (parsed.source) filter.source = parsed.source;
    if (parsed.beforeId) filter.beforeId = parsed.beforeId;
    if (parsed.createdFrom) filter.createdFrom = parsed.createdFrom;
    const page = await listMaSessions(tenantId, filter);
    const agents = await loadAgentNames(tenantId);
    const users = await loadUserBriefs(
      tenantId,
      page.items.map((item) => item.createdByUserId).filter((id): id is string => Boolean(id)),
    );
    return NextResponse.json({
      code: "00000",
      message: "ok",
      data: {
        items: page.items.map((item) => toPublicSession(item, agents, users)),
        nextBeforeId: page.nextBeforeId,
      },
    });
  } catch (error) {
    return maSessionErrorResponse(error);
  }
}
