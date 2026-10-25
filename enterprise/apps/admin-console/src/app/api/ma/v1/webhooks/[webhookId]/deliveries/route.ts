import { NextResponse } from "next/server";
import { listMaWebhookDeliveries } from "@agenticx/iam-core";

import { maError, maErrorFromException } from "../../../../../../../lib/ma/errors";
import { MaRequestError, ULID_RE } from "../../../../../../../lib/ma/http";
import { requireMaPat } from "../../../../../../../lib/ma/pat-auth";
import { toMaWebhookDeliveryRecord } from "../../../../../../../lib/ma/webhook-records";

export const dynamic = "force-dynamic";

function readLimit(raw: string | null): number {
  if (raw == null || raw === "") return 50;
  if (!/^\d+$/.test(raw)) throw new MaRequestError("limit is invalid");
  const value = Number(raw);
  if (value < 1 || value > 200) throw new MaRequestError("limit is invalid");
  return value;
}

export async function GET(request: Request, context: { params: Promise<{ webhookId: string }> }) {
  const auth = await requireMaPat(request, "ma:webhooks:read");
  if (!auth.ok) return auth.response;
  try {
    const { webhookId } = await context.params;
    if (!ULID_RE.test(webhookId)) return maError("webhook_not_found", "webhook not found");
    const limit = readLimit(new URL(request.url).searchParams.get("limit"));
    const deliveries = await listMaWebhookDeliveries(auth.identity.tenantId, webhookId, limit);
    return NextResponse.json({ data: deliveries.map(toMaWebhookDeliveryRecord) });
  } catch (error) {
    return maErrorFromException(error);
  }
}
