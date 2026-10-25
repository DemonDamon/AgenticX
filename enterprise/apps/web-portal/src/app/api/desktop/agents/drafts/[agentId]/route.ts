import { NextResponse } from "next/server";
import {
  getAgentVersion,
  getAgentWithMa,
  listAgentVersions,
  type EnterpriseAgentWithMa,
} from "@agenticx/iam-core";

import { resolveDesktopIdentity } from "../../../../../../lib/desktop-auth";
import { workerErrorResponse, workerUnauthorized } from "../../../../../../lib/worker-tasks/protocol";

export const dynamic = "force-dynamic";

type VersionParse = { kind: "ok"; version: number } | { kind: "invalid" };

function updatedAtIso(value: EnterpriseAgentWithMa["updatedAt"] | Date): string {
  if (typeof value === "object" && value instanceof Date) return value.toISOString();
  return String(value);
}

function toDraftSummary(agent: EnterpriseAgentWithMa) {
  return {
    agent_id: agent.id,
    display_name: agent.displayName,
    description: agent.description,
    local_avatar_id: agent.localAvatarId,
    lifecycle: agent.lifecycle,
    latest_version: agent.latestVersion,
    effective_version: agent.effectiveVersion,
    routing_mode: agent.versionRouting,
    updated_at: updatedAtIso(agent.updatedAt),
  };
}

function notFoundAgent(): NextResponse {
  return NextResponse.json({ code: "40400", message: "智能体不存在" }, { status: 404 });
}

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : "";
}

function parseVersion(raw: string | null, latest: number): VersionParse {
  if (raw == null || raw.trim() === "") return { kind: "ok", version: latest };
  if (!/^[1-9]\d*$/.test(raw.trim())) return { kind: "invalid" };
  return { kind: "ok", version: Number(raw.trim()) };
}

export async function GET(request: Request, context: { params: Promise<{ agentId: string }> }) {
  const identity = await resolveDesktopIdentity(request);
  if (!identity) return workerUnauthorized();
  const { agentId } = await context.params;
  let agent: EnterpriseAgentWithMa;
  try {
    agent = await getAgentWithMa(identity.tenantId, agentId);
  } catch (error) {
    if (errorName(error) === "AgentNotFoundError") return notFoundAgent();
    return workerErrorResponse(error);
  }
  if (agent.origin !== "employee" || agent.ownerUserId !== identity.userId) return notFoundAgent();
  const parsed = parseVersion(new URL(request.url).searchParams.get("version"), agent.latestVersion);
  let versionNumber: number;
  switch (parsed.kind) {
    case "ok":
      versionNumber = parsed.version;
      break;
    case "invalid":
      return NextResponse.json({ code: "40000", message: "version 不合法" }, { status: 400 });
    default: {
      const exhaustive: never = parsed;
      return exhaustive;
    }
  }
  try {
    const row = await getAgentVersion(identity.tenantId, agentId, versionNumber);
    const versions = (await listAgentVersions(identity.tenantId, agentId, { limit: 20 })).slice(0, 20);
    return NextResponse.json({
      agent: toDraftSummary(agent),
      version: {
        version: row.version,
        manifest: row.manifest,
        manifest_hash: row.manifestHash,
        note: row.note,
        source: row.source,
        created_at: row.createdAt,
      },
      versions: versions.map((item) => ({
        version: item.version,
        note: item.note,
        source: item.source,
        created_at: item.createdAt,
      })),
    });
  } catch (error) {
    if (errorName(error) === "AgentVersionNotFoundError") {
      return NextResponse.json({ code: "40401", message: "版本不存在" }, { status: 404 });
    }
    if (errorName(error) === "AgentNotFoundError") return notFoundAgent();
    return workerErrorResponse(error);
  }
}
