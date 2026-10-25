import { NextResponse } from "next/server";
import { rotateMaWebhookSecret } from "@agenticx/iam-core";

import { maError, maErrorFromException } from "../../../../../../../lib/ma/errors";
import { ULID_RE } from "../../../../../../../lib/ma/http";
import { requireMaPat } from "../../../../../../../lib/ma/pat-auth";
import { toMaWebhookRecord } from "../../../../../../../lib/ma/webhook-records";

export const dynamic = "force-dynamic";

export async function POST(request: Request, context: { params: Promise<{ webhookId: string }> }) {
  const auth = await requireMaPat(request, "ma:webhooks:write");
  if (!auth.ok) return auth.response;
  try {
    const { webhookId } = await context.params;
    if (!ULID_RE.test(webhookId)) return maError("webhook_not_found", "webhook not found");
    const rotated = await rotateMaWebhookSecret(auth.identity.tenantId, webhookId);
    return NextResponse.json({
      webhook: toMaWebhookRecord(rotated.webhook),
      signing_secret: rotated.signingSecret,
    });
  } catch (error) {
    return maErrorFromException(error);
  }
}
