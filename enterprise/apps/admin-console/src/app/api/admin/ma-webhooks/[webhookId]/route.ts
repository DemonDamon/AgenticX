import { deleteMaWebhook, getMaWebhook, updateMaWebhook } from "@agenticx/iam-core";

import { requireAdminScope } from "../../../../../lib/admin-auth";
import { toMaWebhookRecord } from "../../../../../lib/ma/webhook-records";
import { assertAdminKeys, automationErrorResponse, ok, readAdminJson, requiredTenantId } from "../../ma-schedules/shared";

export const dynamic = "force-dynamic";

const KEYS = ["name", "url", "event_types", "agent_ids", "sources", "include_result_text", "enabled"] as const;

export async function GET(_request: Request, context: { params: Promise<{ webhookId: string }> }) {
  const auth = await requireAdminScope(["provider:read"]);
  if (!auth.ok) return auth.response;
  try {
    const { webhookId } = await context.params;
    return ok({ webhook: toMaWebhookRecord(await getMaWebhook(requiredTenantId(), webhookId)) });
  } catch (error) {
    return automationErrorResponse(error);
  }
}

export async function PATCH(request: Request, context: { params: Promise<{ webhookId: string }> }) {
  const auth = await requireAdminScope(["provider:update"]);
  if (!auth.ok) return auth.response;
  try {
    const { webhookId } = await context.params;
    const body = await readAdminJson(request);
    assertAdminKeys(body, KEYS);
    const webhook = await updateMaWebhook(requiredTenantId(), webhookId, body);
    return ok({ webhook: toMaWebhookRecord(webhook) });
  } catch (error) {
    return automationErrorResponse(error);
  }
}

export async function DELETE(_request: Request, context: { params: Promise<{ webhookId: string }> }) {
  const auth = await requireAdminScope(["provider:delete"]);
  if (!auth.ok) return auth.response;
  try {
    const { webhookId } = await context.params;
    await deleteMaWebhook(requiredTenantId(), webhookId);
    return ok({ deleted: true });
  } catch (error) {
    return automationErrorResponse(error);
  }
}
