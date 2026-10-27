import { NextResponse } from "next/server";
import { getAgentWithMa, updateAgentMaSettings, type AgentMaSettingsPatch } from "@agenticx/iam-core";

import { requireAdminScope } from "../../../../../../lib/admin-auth";
import { agentErrorResponse, requiredTenantId } from "../../shared";

export const dynamic = "force-dynamic";

const ALLOWED_KEYS = ["defaultEnvironmentId", "versionRouting", "pinnedVersion"] as const;

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function badRequest(message: string): NextResponse {
  return NextResponse.json({ code: "40000", message }, { status: 400 });
}

export async function GET(_request: Request, context: { params: Promise<{ agentId: string }> }) {
  const auth = await requireAdminScope(["provider:read"]);
  if (!auth.ok) return auth.response;
  try {
    const { agentId } = await context.params;
    const agent = await getAgentWithMa(requiredTenantId(), agentId);
    return NextResponse.json({ code: "00000", message: "ok", data: { agent } });
  } catch (error) {
    return agentErrorResponse(error);
  }
}

export async function PATCH(request: Request, context: { params: Promise<{ agentId: string }> }) {
  const auth = await requireAdminScope(["provider:update"]);
  if (!auth.ok) return auth.response;
  try {
    const { agentId } = await context.params;
    const body = await request.json().catch(() => null);
    if (!isJsonObject(body)) return badRequest("请求体不是合法 JSON");
    const unknown = Object.keys(body)
      .filter((key) => !(ALLOWED_KEYS as readonly string[]).includes(key))
      .sort();
    if (unknown[0]) return badRequest(`不支持的字段：${unknown[0]}`);

    const patch: AgentMaSettingsPatch = {};
    if ("defaultEnvironmentId" in body) {
      if (body.defaultEnvironmentId !== null && typeof body.defaultEnvironmentId !== "string") {
        return badRequest("字段类型不合法：defaultEnvironmentId");
      }
      patch.defaultEnvironmentId = body.defaultEnvironmentId;
    }
    if ("versionRouting" in body) {
      if (body.versionRouting !== "follow_latest" && body.versionRouting !== "pinned") {
        return badRequest("字段类型不合法：versionRouting");
      }
      patch.versionRouting = body.versionRouting;
    }
    if ("pinnedVersion" in body) {
      if (body.pinnedVersion !== null && (typeof body.pinnedVersion !== "number" || !Number.isInteger(body.pinnedVersion))) {
        return badRequest("字段类型不合法：pinnedVersion");
      }
      patch.pinnedVersion = body.pinnedVersion;
    }
    const agent = await updateAgentMaSettings(requiredTenantId(), agentId, patch);
    return NextResponse.json({ code: "00000", message: "ok", data: { agent } });
  } catch (error) {
    return agentErrorResponse(error);
  }
}
