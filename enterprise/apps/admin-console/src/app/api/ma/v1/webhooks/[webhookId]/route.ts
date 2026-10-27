import { NextResponse } from "next/server";
import { deleteMaWebhook, getMaWebhook, updateMaWebhook } from "@agenticx/iam-core";

import { maError, maErrorFromException } from "../../../../../../lib/ma/errors";
import { assertOnlyKeys, readJsonObject, ULID_RE } from "../../../../../../lib/ma/http";
import { requireMaPat } from "../../../../../../lib/ma/pat-auth";
import { toMaWebhookRecord } from "../../../../../../lib/ma/webhook-records";

export const dynamic = "force-dynamic";

const KEYS = ["name", "description", "url", "event_types", "agent_ids", "sources", "include_result_text", "enabled"] as const;

export async function GET(request: Request, context: { params: Promise<{ webhookId: string }> }) {
  const auth = await requireMaPat(request, "ma:webhooks:read");
  if (!auth.ok) return auth.response;
  try {
    const { webhookId } = await context.params;
    if (!ULID_RE.test(webhookId)) return maError("webhook_not_found", "webhook not found");
    return NextResponse.json({ webhook: toMaWebhookRecord(await getMaWebhook(auth.identity.tenantId, webhookId)) });
  } catch (error) {
    return maErrorFromException(error);
  }
}

export async function PATCH(request: Request, context: { params: Promise<{ webhookId: string }> }) {
  const auth = await requireMaPat(request, "ma:webhooks:write");
  if (!auth.ok) return auth.response;
  try {
    const { webhookId } = await context.params;
    if (!ULID_RE.test(webhookId)) return maError("webhook_not_found", "webhook not found");
    const body = await readJsonObject(request);
    assertOnlyKeys(body, KEYS);
    const webhook = await updateMaWebhook(auth.identity.tenantId, webhookId, body);
    return NextResponse.json({ webhook: toMaWebhookRecord(webhook) });
  } catch (error) {
    return maErrorFromException(error);
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ webhookId: string }> }) {
  const auth = await requireMaPat(request, "ma:webhooks:write");
  if (!auth.ok) return auth.response;
  try {
    const { webhookId } = await context.params;
    if (!ULID_RE.test(webhookId)) return maError("webhook_not_found", "webhook not found");
    await deleteMaWebhook(auth.identity.tenantId, webhookId);
    return NextResponse.json({ deleted: true });
  } catch (error) {
    return maErrorFromException(error);
  }
}
