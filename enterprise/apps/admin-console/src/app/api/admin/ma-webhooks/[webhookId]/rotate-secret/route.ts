import { rotateMaWebhookSecret } from "@agenticx/iam-core";

import { requireAdminScope } from "../../../../../../lib/admin-auth";
import { toMaWebhookRecord } from "../../../../../../lib/ma/webhook-records";
import { automationErrorResponse, ok, requiredTenantId } from "../../../ma-schedules/shared";

export const dynamic = "force-dynamic";

export async function POST(_request: Request, context: { params: Promise<{ webhookId: string }> }) {
  const auth = await requireAdminScope(["provider:update"]);
  if (!auth.ok) return auth.response;
  try {
    const { webhookId } = await context.params;
    const rotated = await rotateMaWebhookSecret(requiredTenantId(), webhookId);
    return ok({ webhook: toMaWebhookRecord(rotated.webhook), signing_secret: rotated.signingSecret });
  } catch (error) {
    return automationErrorResponse(error);
  }
}
