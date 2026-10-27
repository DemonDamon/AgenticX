import { NextResponse } from "next/server";
import {
  getAgentVersion,
  getAgentWithMa,
  listAgentsVisibleToKeys,
  listMaEnvironments,
  resolveAssignmentKeysForUser,
} from "@agenticx/iam-core";
import { resolveDesktopIdentity } from "../../../../../lib/desktop-auth";
import { buildManifestSummary, toDesktopAgentCard } from "../../../../../lib/desktop-agent-catalog";
import { workerErrorResponse, workerUnauthorized } from "../../../../../lib/worker-tasks/protocol";

export const dynamic = "force-dynamic";

const ULID_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/;

function notFound(): NextResponse {
  return NextResponse.json({ code: "40400", message: "智能体不存在或未分配给你" }, { status: 404 });
}

function isMissingAgent(error: unknown): boolean {
  return error instanceof Error && (error.name === "AgentNotFoundError" || error.name === "AgentVersionNotFoundError");
}

export async function GET(request: Request, context: { params: Promise<{ agentId: string }> }) {
  const identity = await resolveDesktopIdentity(request);
  if (!identity) return workerUnauthorized();
  const { agentId } = await context.params;
  if (!ULID_RE.test(agentId)) return notFound();
  try {
    const keys = await resolveAssignmentKeysForUser(
      identity.tenantId,
      identity.userId,
      identity.email,
      identity.deptId,
    );
    const visible = await listAgentsVisibleToKeys(identity.tenantId, keys);
    const agent = visible.find((item) => item.id === agentId);
    if (!agent) return notFound();
    const ma = await getAgentWithMa(identity.tenantId, agentId);
    const envs = await listMaEnvironments(identity.tenantId, { status: "active" });
    const version = await getAgentVersion(identity.tenantId, agentId, ma.effectiveVersion);
    return NextResponse.json({
      agent: toDesktopAgentCard(agent, ma, new Map(envs.map((item) => [item.id, item])), identity.userId),
      version: {
        version: version.version,
        createdAt: version.createdAt,
        note: version.note ?? null,
        summary: buildManifestSummary(version.manifest),
      },
    });
  } catch (error) {
    if (isMissingAgent(error)) return notFound();
    return workerErrorResponse(error);
  }
}
