import { NextResponse } from "next/server";
import { getMaSession, listMaWorkItems } from "@agenticx/iam-core";

import { requireAdminScope } from "../../../../../lib/admin-auth";
import {
  ULID_RE,
  loadAgentNames,
  loadUserBriefs,
  maSessionErrorResponse,
  sessionNotFoundResponse,
  toPublicDetail,
} from "../shared";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ sessionId: string }> }) {
  const guard = await requireAdminScope(["audit:read:all"]);
  if (!guard.ok) return guard.response;
  try {
    const { sessionId } = await context.params;
    if (!ULID_RE.test(sessionId)) return sessionNotFoundResponse();
    const tenantId = guard.session.tenantId;
    const session = await getMaSession(tenantId, sessionId);
    if (!session) return sessionNotFoundResponse();
    const workItems = await listMaWorkItems(tenantId, sessionId);
    const agents = await loadAgentNames(tenantId);
    const users = await loadUserBriefs(tenantId, session.createdByUserId ? [session.createdByUserId] : []);
    return NextResponse.json({
      code: "00000",
      message: "ok",
      data: { session: toPublicDetail(session, agents, users), workItems },
    });
  } catch (error) {
    return maSessionErrorResponse(error);
  }
}
