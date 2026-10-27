import { NextResponse } from "next/server";
import { autoDisableMaWebhook } from "@agenticx/iam-core";

import { maErrorFromException } from "../../../../../../../lib/ma/errors";
import { assertOnlyKeys, MaRequestError, readJsonObject, TENANT_ID_RE } from "../../../../../../../lib/ma/http";
import { isMaInternalAuthorized, maInternalUnauthorized } from "../../../../../../../lib/ma/internal-auth";

export const dynamic = "force-dynamic";

const REASONS = ["consecutive_failures", "gone"] as const;

function noStore(response: NextResponse): NextResponse {
  response.headers.set("cache-control", "no-store");
  return response;
}

function isReason(value: unknown): value is (typeof REASONS)[number] {
  return value === "consecutive_failures" || value === "gone";
}

export async function POST(request: Request, context: { params: Promise<{ webhookId: string }> }) {
  if (!isMaInternalAuthorized(request)) return noStore(maInternalUnauthorized());
  try {
    const { webhookId } = await context.params;
    const body = await readJsonObject(request);
    assertOnlyKeys(body, ["tenant_id", "reason"]);
    const tenantId = typeof body.tenant_id === "string" ? body.tenant_id.trim() : "";
    if (!TENANT_ID_RE.test(tenantId)) throw new MaRequestError("tenant_id is required");
    if (!webhookId.trim()) throw new MaRequestError("webhook id is required");
    if (!isReason(body.reason)) throw new MaRequestError("reason is invalid");
    const disabled = await autoDisableMaWebhook(tenantId, webhookId, body.reason);
    return noStore(NextResponse.json({ data: { disabled } }));
  } catch (error) {
    return noStore(maErrorFromException(error));
  }
}
