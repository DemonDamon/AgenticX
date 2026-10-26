import { createMaWebhook, listMaWebhooks } from "@agenticx/iam-core";

import { requireAdminScope } from "../../../../lib/admin-auth";
import { toMaWebhookRecord } from "../../../../lib/ma/webhook-records";
import { assertAdminKeys, automationErrorResponse, ok, readAdminJson, requiredTenantId } from "../ma-schedules/shared";

export const dynamic = "force-dynamic";

const KEYS = ["name", "description", "url", "event_types", "agent_ids", "sources", "include_result_text", "enabled"] as const;

export async function GET() {
  const auth = await requireAdminScope(["provider:read"]);
  if (!auth.ok) return auth.response;
  try {
    const webhooks = await listMaWebhooks(requiredTenantId());
    return ok({ webhooks: webhooks.map(toMaWebhookRecord) });
  } catch (error) {
    return automationErrorResponse(error);
  }
}

export async function POST(request: Request) {
  const auth = await requireAdminScope(["provider:update"]);
  if (!auth.ok) return auth.response;
  try {
    const body = await readAdminJson(request);
    assertAdminKeys(body, KEYS);
    const created = await createMaWebhook(requiredTenantId(), body, auth.session.userId);
    return ok({ webhook: toMaWebhookRecord(created.webhook), signing_secret: created.signingSecret });
  } catch (error) {
    return automationErrorResponse(error);
  }
}
