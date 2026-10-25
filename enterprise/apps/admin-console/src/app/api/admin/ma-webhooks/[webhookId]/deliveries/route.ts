import { listMaWebhookDeliveries } from "@agenticx/iam-core";

import { requireAdminScope } from "../../../../../../lib/admin-auth";
import { MaRequestError } from "../../../../../../lib/ma/http";
import { toMaWebhookDeliveryRecord } from "../../../../../../lib/ma/webhook-records";
import { automationErrorResponse, ok, requiredTenantId } from "../../../ma-schedules/shared";

export const dynamic = "force-dynamic";

function readLimit(raw: string | null): number {
  if (raw == null || raw === "") return 50;
  if (!/^\d+$/.test(raw)) throw new MaRequestError("limit is invalid");
  const value = Number(raw);
  if (value < 1 || value > 200) throw new MaRequestError("limit is invalid");
  return value;
}

export async function GET(request: Request, context: { params: Promise<{ webhookId: string }> }) {
  const auth = await requireAdminScope(["provider:read"]);
  if (!auth.ok) return auth.response;
  try {
    const { webhookId } = await context.params;
    const deliveries = await listMaWebhookDeliveries(
      requiredTenantId(),
      webhookId,
      readLimit(new URL(request.url).searchParams.get("limit")),
    );
    return ok({ deliveries: deliveries.map(toMaWebhookDeliveryRecord) });
  } catch (error) {
    return automationErrorResponse(error);
  }
}
