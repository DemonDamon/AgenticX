/**
 * SP5 incident-response-loop：处置编排（console 侧）。
 *
 * 纪律「先审计后动作」：每个动作先把意图写入 iam 审计（insertAuditEvent），
 * 再执行持久化（DB/file store），再调网关 internal 端点落防篡改链 + 即时吊销。
 * 失败不静默：动作明细 outcome=failed + incident 保持可处置状态，UI 报错。
 *
 * 动作语义（网关侧即时生效由 gateway internal 端点完成）：
 * - terminate_session：断 refresh（auth_refresh_sessions）+ 写 session 吊销快照（网关轮询恢复）
 * - revoke_pat：复用 revokePat（DB status + PAT 吊销快照）
 * - disable_user：users.status='disabled' + 该用户全部 PAT 逐个吊销 + 全部 session 逐个终止
 * - block_model：provider enabled=false（复用既有 provider store，注入 executor）
 */
import {
  getPatHash,
  insertAuditEvent,
  listPats,
  listUserSessionIds,
  recordSessionRevocation,
  revokePat,
  setUserStatusDisabled,
  deleteRefreshSessionBySessionId,
  insertSecurityIncidentAction,
  listSecurityIncidentActions,
  type SecurityIncidentActionRecord,
  type SecurityIncidentActionType,
  type SecurityIncidentRecord,
} from "@agenticx/iam-core";

import { gatewayInternalBase } from "./gateway-internal-base";
import { getGatewayInternalToken } from "./gateway-internal-token";

export type IncidentActor = {
  userId: string;
  email?: string | null;
};

export type IncidentActionInput = {
  tenantId: string;
  incidentId: string;
  action: SecurityIncidentActionType;
  /** 动作目标：session=sessionId；pat=patId；user=userId；model=modelId */
  targetId: string;
  actor: IncidentActor;
  /** disable_user 二次确认（风险表：user 级需 confirm:true + 邮箱匹配）。 */
  confirm?: boolean;
  confirmUserEmail?: string;
};

export type IncidentActionDeps = {
  /** block_model 执行体（注入 provider store，避免 lib 依赖 app 层）。 */
  blockModel?: (tenantId: string, modelId: string) => Promise<void>;
  /** 网关 internal 调用（测试注入 mock）。 */
  notifyGateway?: (payload: GatewayIncidentActionPayload) => Promise<void>;
};

export type GatewayIncidentActionPayload = {
  incident_id: string;
  action: SecurityIncidentActionType;
  target_type: string;
  target_id?: string;
  target_hash?: string;
  actor?: string;
  tenant_id: string;
};

async function defaultNotifyGateway(payload: GatewayIncidentActionPayload): Promise<void> {
  const token = getGatewayInternalToken();
  if (!token) throw new Error("GATEWAY_INTERNAL_TOKEN is required for incident actions");
  const resp = await fetch(`${gatewayInternalBase()}/internal/security/incident-action`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });
  if (!resp.ok) {
    throw new Error(`gateway incident action failed: ${resp.status}`);
  }
}

function targetTypeOf(action: SecurityIncidentActionType): string {
  switch (action) {
    case "terminate_session":
      return "session";
    case "revoke_pat":
      return "pat";
    case "disable_user":
      return "user";
    case "block_model":
      return "model";
  }
}

export class IncidentActionError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
  ) {
    super(message);
  }
}

async function runSingleAction(
  input: IncidentActionInput,
  deps: IncidentActionDeps,
  action: SecurityIncidentActionType,
  targetId: string,
): Promise<{ detail: Record<string, unknown> }> {
  const payload: GatewayIncidentActionPayload = {
    incident_id: input.incidentId,
    action,
    target_type: targetTypeOf(action),
    target_id: targetId,
    actor: input.actor.userId,
    tenant_id: input.tenantId,
  };
  if (action === "revoke_pat") {
    const hash = await getPatHash(Number(targetId), input.tenantId);
    if (!hash) throw new IncidentActionError(`pat ${targetId} not found`, 404);
    payload.target_hash = hash;
  }
  const notify = deps.notifyGateway ?? defaultNotifyGateway;
  switch (action) {
    case "terminate_session": {
      // 1. 先审计（意图先于动作）
      await insertAuditEvent({
        tenantId: input.tenantId,
        actorUserId: input.actor.userId,
        eventType: "incident_action_executed",
        targetKind: "session",
        targetId,
        detail: { incident_id: input.incidentId, action, stage: "intent" },
      });
      // 2. 持久化：断 refresh 续命 + 写网关轮询快照
      await deleteRefreshSessionBySessionId(targetId);
      await recordSessionRevocation(targetId);
      // 3. 网关：落防篡改链 + access 即时 401
      await notify(payload);
      return { detail: { session_id: targetId } };
    }
    case "revoke_pat": {
      await insertAuditEvent({
        tenantId: input.tenantId,
        actorUserId: input.actor.userId,
        eventType: "incident_action_executed",
        targetKind: "pat",
        targetId,
        detail: { incident_id: input.incidentId, action, stage: "intent" },
      });
      const record = await revokePat(Number(targetId), input.tenantId);
      if (!record) throw new IncidentActionError(`pat ${targetId} not found`, 404);
      await notify(payload);
      return { detail: { pat_id: targetId, pat_name: record.name } };
    }
    case "disable_user": {
      await insertAuditEvent({
        tenantId: input.tenantId,
        actorUserId: input.actor.userId,
        eventType: "incident_action_executed",
        targetKind: "user",
        targetId,
        detail: { incident_id: input.incidentId, action, stage: "intent" },
      });
      const applied = await setUserStatusDisabled(input.tenantId, targetId);
      if (!applied) throw new IncidentActionError(`user ${targetId} not found`, 404);
      await notify(payload);
      const patRecords = (await listPats({ tenantId: input.tenantId, userId: targetId })).filter(
        (pat) => pat.status === "active",
      );
      for (const pat of patRecords) {
        await runSingleAction(input, deps, "revoke_pat", String(pat.id));
      }
      const sessionIds = await listUserSessionIds(targetId);
      for (const sessionId of sessionIds) {
        await runSingleAction(input, deps, "terminate_session", sessionId);
      }
      return {
        detail: {
          user_id: targetId,
          revoked_pats: patRecords.length,
          terminated_sessions: sessionIds.length,
        },
      };
    }
    case "block_model": {
      if (!deps.blockModel) {
        throw new IncidentActionError("block_model executor not configured", 501);
      }
      await insertAuditEvent({
        tenantId: input.tenantId,
        actorUserId: input.actor.userId,
        eventType: "incident_action_executed",
        targetKind: "model",
        targetId,
        detail: { incident_id: input.incidentId, action, stage: "intent" },
      });
      await notify(payload);
      await deps.blockModel(input.tenantId, targetId);
      return { detail: { model: targetId } };
    }
  }
}

/** 一键处置入口：先整体留痕 → 执行 → 写动作明细 → open 事件自动流转 handling。 */
export async function executeIncidentAction(
  input: IncidentActionInput,
  deps: IncidentActionDeps,
): Promise<SecurityIncidentActionRecord> {
  if (input.action === "disable_user") {
    // user 级二次确认（MASTER-PLAN 风险表）：confirm=true + 操作员复述本人邮箱（输入邮箱匹配即意图证明）。
    if (input.confirm !== true) {
      throw new IncidentActionError("disable_user requires confirm=true (二次确认)", 400);
    }
    const expected = (input.actor.email ?? "").trim().toLowerCase();
    if (!expected) {
      throw new IncidentActionError("disable_user requires operator email for confirmation", 400);
    }
    if ((input.confirmUserEmail ?? "").trim().toLowerCase() !== expected) {
      throw new IncidentActionError("disable_user confirmation email mismatch", 400);
    }
  }
  let outcome: "done" | "failed" = "done";
  let detail: Record<string, unknown> = { action: input.action, target_id: input.targetId };
  try {
    const result = await runSingleAction(input, deps, input.action, input.targetId);
    detail = { ...detail, ...result.detail };
  } catch (err) {
    outcome = "failed";
    detail = { ...detail, error: err instanceof Error ? err.message : String(err) };
  }
  const record = await insertSecurityIncidentAction({
    incidentId: input.incidentId,
    tenantId: input.tenantId,
    actionType: input.action,
    targetType: targetTypeOf(input.action),
    targetId: input.targetId,
    actorUserId: input.actor.userId,
    detail,
    outcome,
  });
  if (outcome === "failed") {
    throw new IncidentActionError(
      `incident action failed: ${String(detail.error ?? "unknown")}`,
      502,
    );
  }
  return record;
}

export async function listIncidentActionsFor(
  tenantId: string,
  incidentId: string,
): Promise<SecurityIncidentActionRecord[]> {
  return listSecurityIncidentActions(tenantId, incidentId);
}

export type { SecurityIncidentRecord };
