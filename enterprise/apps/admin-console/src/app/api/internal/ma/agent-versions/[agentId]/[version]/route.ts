import { NextResponse } from "next/server";
import {
  ensureAgentVersionOne,
  getAgentVersion,
  getAgentWithMa,
  type EnterpriseAgentWithMa,
} from "@agenticx/iam-core";

import { maError, maErrorFromException } from "../../../../../../../lib/ma/errors";
import { isMaInternalAuthorized, maInternalUnauthorized } from "../../../../../../../lib/ma/internal-auth";
import { MaRequestError, parseVersionParam, TENANT_ID_RE, ULID_RE } from "../../../../../../../lib/ma/http";
import { toMaAgentRecord, toMaAgentRouting, toMaAgentVersionRecord } from "../../../../../../../lib/ma/records";

export const dynamic = "force-dynamic";

function noStore(response: NextResponse): NextResponse {
  response.headers.set("cache-control", "no-store");
  return response;
}

function resolveVersion(parsed: "latest" | "effective" | number, agent: EnterpriseAgentWithMa): number {
  if (typeof parsed === "number") return parsed;
  switch (parsed) {
    case "latest":
      return agent.latestVersion;
    case "effective":
      return agent.effectiveVersion;
    default: {
      const unreachable: never = parsed;
      throw new MaRequestError(String(unreachable));
    }
  }
}

export async function GET(request: Request, context: { params: Promise<{ agentId: string; version: string }> }) {
  if (!isMaInternalAuthorized(request)) return noStore(maInternalUnauthorized());
  try {
    const tenantId = new URL(request.url).searchParams.get("tenant_id") ?? "";
    if (!TENANT_ID_RE.test(tenantId)) return noStore(maError("invalid_request", "tenant_id is required"));
    const { agentId, version } = await context.params;
    if (!ULID_RE.test(agentId)) return noStore(maError("agent_not_found", "agent not found"));
    const parsed = parseVersionParam(version);
    const ensured = await ensureAgentVersionOne(tenantId, agentId);
    switch (ensured.status) {
      case "exists":
      case "created":
        break;
      case "invalid":
        return noStore(maError("agent_version_not_found", "agent version not found"));
      default: {
        const unreachable: never = ensured;
        return noStore(maError("internal_error", String(unreachable)));
      }
    }
    const agent = await getAgentWithMa(tenantId, agentId);
    const row = await getAgentVersion(tenantId, agentId, resolveVersion(parsed, agent));
    return noStore(
      NextResponse.json({
        agent: toMaAgentRecord(agent),
        routing: toMaAgentRouting(agent),
        runtime: agent.runtime,
        version: toMaAgentVersionRecord(row),
      }),
    );
  } catch (error) {
    return noStore(maErrorFromException(error));
  }
}
