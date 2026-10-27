import { NextResponse } from "next/server";
import { getMaSession, listMaSessionEvents } from "@agenticx/iam-core";

import { requireAdminScope } from "../../../../../../lib/admin-auth";
import { ULID_RE, maSessionErrorResponse, sessionNotFoundResponse } from "../../shared";

export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ sessionId: string }> }) {
  const guard = await requireAdminScope(["audit:read:all"]);
  if (!guard.ok) return guard.response;
  try {
    const { sessionId } = await context.params;
    if (!ULID_RE.test(sessionId)) return sessionNotFoundResponse();
    const query = parseEventsQuery(new URL(request.url).searchParams);
    const tenantId = guard.session.tenantId;
    const session = await getMaSession(tenantId, sessionId);
    if (!session) return sessionNotFoundResponse();
    const page = await listMaSessionEvents(tenantId, sessionId, { afterSeq: query.afterSeq, limit: query.limit });
    return NextResponse.json({
      code: "00000",
      message: "ok",
      data: { items: page.items, nextAfterSeq: page.nextAfterSeq },
    });
  } catch (error) {
    return maSessionErrorResponse(error);
  }
}

function parseEventsQuery(params: URLSearchParams): { afterSeq: number; limit: number } {
  const afterRaw = params.get("after_seq");
  let afterSeq = 0;
  if (afterRaw != null && afterRaw.trim() !== "") {
    const text = afterRaw.trim();
    if (!/^\d+$/.test(text)) throw new Error("分页参数不合法");
    afterSeq = Number(text);
  }
  const limitRaw = params.get("limit");
  let limit = 500;
  if (limitRaw != null && limitRaw.trim() !== "") {
    const text = limitRaw.trim();
    if (!/^\d+$/.test(text)) throw new Error("分页参数不合法");
    limit = Number(text);
    if (limit < 1 || limit > 500) throw new Error("分页参数不合法");
  }
  return { afterSeq, limit };
}
