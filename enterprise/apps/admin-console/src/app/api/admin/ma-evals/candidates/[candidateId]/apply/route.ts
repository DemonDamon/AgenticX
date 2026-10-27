import {
  AgentManifestInvalidError,
  AgentVersionConflictError,
  createAgentVersion,
  getAgentWithMa,
  getEvalCandidate,
  updateAgentMaSettings,
} from "@agenticx/iam-core";

import { requireAdminScope } from "../../../../../../../lib/admin-auth";
import { runtimeInternal } from "../../../../../../../lib/ma/runtime-internal-client";
import { evalErrorResponse, fail, ok, requiredTenantId } from "../../../shared";

export const dynamic = "force-dynamic";

export async function POST(_request: Request, context: { params: Promise<{ candidateId: string }> }) {
  const auth = await requireAdminScope(["provider:update"]);
  if (!auth.ok) return auth.response;
  try {
    const { candidateId } = await context.params;
    const tenantId = requiredTenantId();
    const cand = await getEvalCandidate(tenantId, candidateId);
    if (!cand) return fail(404, "候选不存在");
    if (cand.status === "applied") return ok({ version: cand.appliedVersion, created: false });
    if (cand.status !== "proposed") return fail(409, "该候选已被丢弃");
    const agent = await getAgentWithMa(tenantId, cand.agentId);
    let routingPinned = false;
    if (agent.lifecycle === "published" && agent.versionRouting === "follow_latest") {
      await updateAgentMaSettings(tenantId, agent.id, {
        versionRouting: "pinned",
        pinnedVersion: agent.effectiveVersion,
      });
      routingPinned = true;
    }
    let created: Awaited<ReturnType<typeof createAgentVersion>>;
    try {
      created = await createAgentVersion(tenantId, agent.id, {
        manifest: cand.manifest,
        expectedLatestVersion: agent.latestVersion,
        note: `评测候选 ${cand.id}（基于 v${cand.baseVersion}）`,
        createdBy: auth.session.userId,
        source: "admin",
      });
    } catch (error) {
      if (error instanceof AgentVersionConflictError) return fail(409, "智能体版本已被他人更新，请刷新后重试");
      if (error instanceof AgentManifestInvalidError) {
        return fail(400, error.message, { errors: error.errors });
      }
      throw error;
    }
    try {
      await runtimeInternal("POST", `/internal/ma/eval-candidates/${cand.id}/status`, {
        tenant_id: tenantId,
        status: "applied",
        applied_version: created.version.version,
        decided_by_user_id: auth.session.userId,
      });
    } catch {
      return fail(502, `已创建版本 v${created.version.version}，但候选状态未更新，请重试`);
    }
    const refreshed = await getAgentWithMa(tenantId, agent.id);
    return ok({
      version: created.version.version,
      created: created.created,
      routing_pinned: routingPinned,
      effective_version: refreshed.effectiveVersion,
    });
  } catch (error) {
    return evalErrorResponse(error);
  }
}
