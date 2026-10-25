import { NextResponse } from "next/server";
import { listEnabledMaWebhooksForRuntime } from "@agenticx/iam-core";

import { maErrorFromException } from "../../../../../lib/ma/errors";
import { isMaInternalAuthorized, maInternalUnauthorized } from "../../../../../lib/ma/internal-auth";

export const dynamic = "force-dynamic";

function noStore(response: NextResponse): NextResponse {
  response.headers.set("cache-control", "no-store");
  return response;
}

export async function GET(request: Request) {
  if (!isMaInternalAuthorized(request)) return noStore(maInternalUnauthorized());
  try {
    const webhooks = await listEnabledMaWebhooksForRuntime();
    return noStore(
      NextResponse.json({
        data: webhooks.map((item) => ({
          id: item.id,
          tenant_id: item.tenantId,
          url: item.url,
          event_types: item.eventTypes,
          agent_ids: item.agentIds,
          sources: item.sources,
          include_result_text: item.includeResultText,
          signing_secret: item.signingSecret,
        })),
      }),
    );
  } catch (error) {
    return noStore(maErrorFromException(error));
  }
}
