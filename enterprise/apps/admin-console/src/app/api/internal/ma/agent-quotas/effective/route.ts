import { NextResponse } from "next/server";

import { TENANT_ID_RE, ULID_RE } from "../../../../../../lib/ma/http";
import { isMaInternalAuthorized, maInternalUnauthorized } from "../../../../../../lib/ma/internal-auth";
import { maError, maErrorFromException } from "../../../../../../lib/ma/errors";
import { readEffectiveAgentQuota } from "../../../../../../lib/metering-service";

export const dynamic = "force-dynamic";

function noStore(response: NextResponse): NextResponse {
  response.headers.set("cache-control", "no-store");
  return response;
}

export async function GET(request: Request) {
  if (!isMaInternalAuthorized(request)) return noStore(maInternalUnauthorized());
  try {
    const url = new URL(request.url);
    const tenantId = (url.searchParams.get("tenant_id") ?? "").trim();
    const agentId = (url.searchParams.get("agent_id") ?? "").trim();
    const userId = (url.searchParams.get("user_id") ?? "").trim();
    if (!TENANT_ID_RE.test(tenantId)) return noStore(maError("invalid_request", "tenant_id is required"));
    if (!ULID_RE.test(agentId)) return noStore(maError("invalid_request", "agent_id is required"));
    if (!ULID_RE.test(userId)) return noStore(maError("invalid_request", "user_id is required"));
    const rule = await readEffectiveAgentQuota(tenantId, agentId, userId);
    if (!rule) return noStore(NextResponse.json({ quota: null }));
    return noStore(
      NextResponse.json({
        quota: {
          source: rule.subject,
          rule_id: rule.id,
          daily_tokens: rule.dailyTokens,
          weekly_tokens: rule.weeklyTokens,
          monthly_tokens: rule.monthlyTokens,
        },
      }),
    );
  } catch (error) {
    return noStore(maErrorFromException(error));
  }
}
