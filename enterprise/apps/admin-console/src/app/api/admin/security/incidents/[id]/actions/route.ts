import { NextResponse } from "next/server";

import { getSecurityIncident, updateSecurityIncidentStatus } from "@agenticx/iam-core";

import { requireAdminScope } from "../../../../../../../lib/admin-auth";
import { updateProviderModel } from "../../../../../../../lib/model-providers-store";
import {
  executeIncidentAction,
  IncidentActionError,
} from "../../../../../../../lib/incident-response";

export const runtime = "nodejs";

/**
 * SP5 incident-response：一键处置入口（处置面板调用）。
 * 编排纪律：先审计 → 持久化 → 网关落链+即时吊销 → 动作明细 → open 自动流转 handling。
 * user 级动作（disable_user）强制二次确认（confirm=true + 邮箱匹配）。
 */
type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: Request, ctx: RouteContext) {
  const auth = await requireAdminScope(["provider:update"]);
  if (!auth.ok) return auth.response;
  const { id } = await ctx.params;
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ code: "40001", message: "invalid json" }, { status: 400 });
  }
  const action = typeof body.action === "string" ? body.action : "";
  if (!["terminate_session", "revoke_pat", "disable_user", "block_model"].includes(action)) {
    return NextResponse.json({ code: "40001", message: "invalid action" }, { status: 400 });
  }
  const targetId = typeof body.targetId === "string" ? body.targetId.trim() : "";
  if (!targetId || targetId.length > 160) {
    return NextResponse.json({ code: "40001", message: "targetId required" }, { status: 400 });
  }
  const incident = await getSecurityIncident(auth.session.tenantId, id);
  if (!incident) {
    return NextResponse.json({ code: "40401", message: "incident not found" }, { status: 404 });
  }
  const confirm = body.confirm === true;
  const confirmUserEmail =
    typeof body.confirmUserEmail === "string" ? body.confirmUserEmail.trim().toLowerCase() : "";
  const actorEmail = (auth.session.email ?? "").trim().toLowerCase();

  try {
    const record = await executeIncidentAction(
      {
        tenantId: auth.session.tenantId,
        incidentId: id,
        action: action as "terminate_session" | "revoke_pat" | "disable_user" | "block_model",
        targetId,
        actor: { userId: auth.session.userId, email: auth.session.email },
        confirm,
        confirmUserEmail,
      },
      {
        blockModel: async (tenantId, modelTarget) => {
          const sep = modelTarget.indexOf("/");
          const providerId = sep > 0 ? modelTarget.slice(0, sep) : modelTarget;
          const modelName = sep > 0 ? modelTarget.slice(sep + 1) : "";
          if (!providerId || !modelName) {
            throw new Error(`block_model target must be providerId/modelName, got: ${modelTarget}`);
          }
          await updateProviderModel(providerId, modelName, { enabled: false });
        },
      },
    );
    // 处置即响应：open 事件自动进入 handling（人工结案走 PATCH resolved）。
    if (incident.status === "open") {
      await updateSecurityIncidentStatus({
        tenantId: auth.session.tenantId,
        incidentId: id,
        status: "handling",
      }).catch(() => undefined);
    }
    return NextResponse.json({ code: "00000", message: "ok", data: record });
  } catch (err) {
    if (err instanceof IncidentActionError) {
      return NextResponse.json({ code: "40002", message: err.message }, { status: err.statusCode });
    }
    const message = err instanceof Error ? err.message : "incident action failed";
    return NextResponse.json({ code: "50000", message }, { status: 500 });
  }
}
