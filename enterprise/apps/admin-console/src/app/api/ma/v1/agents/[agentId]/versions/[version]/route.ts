import { NextResponse } from "next/server";
import { ensureAgentVersionOne, getAgentVersion, getAgentWithMa, type EnterpriseAgentWithMa } from "@agenticx/iam-core";

import { maError, maErrorFromException } from "../../../../../../../../lib/ma/errors";
import { MaRequestError, parseVersionParam, ULID_RE } from "../../../../../../../../lib/ma/http";
import { requireMaPat } from "../../../../../../../../lib/ma/pat-auth";
import { toMaAgentVersionRecord } from "../../../../../../../../lib/ma/records";

export const dynamic = "force-dynamic";

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
  const auth = await requireMaPat(request, "ma:agents:read");
  if (!auth.ok) return auth.response;
  try {
    const { agentId, version } = await context.params;
    if (!ULID_RE.test(agentId)) return maError("agent_not_found", "agent not found");
    const parsed = parseVersionParam(version);
    const tenantId = auth.identity.tenantId;
    const ensured = await ensureAgentVersionOne(tenantId, agentId);
    switch (ensured.status) {
      case "exists":
      case "created":
        break;
      case "invalid":
        return maError("agent_version_not_found", "agent version not found");
      default: {
        const unreachable: never = ensured;
        return maError("internal_error", String(unreachable));
      }
    }
    const agent = await getAgentWithMa(tenantId, agentId);
    const row = await getAgentVersion(tenantId, agentId, resolveVersion(parsed, agent));
    return NextResponse.json({ version: toMaAgentVersionRecord(row) });
  } catch (error) {
    return maErrorFromException(error);
  }
}
