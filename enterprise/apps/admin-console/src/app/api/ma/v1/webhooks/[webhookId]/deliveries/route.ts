import { NextResponse } from "next/server";

import { maError, maErrorFromException } from "../../../../../../../lib/ma/errors";
import { MaRequestError, ULID_RE } from "../../../../../../../lib/ma/http";
import { requireMaPat } from "../../../../../../../lib/ma/pat-auth";
import { MaRuntimeRequestError, MaRuntimeUnavailableError } from "../../../../../../../lib/ma/runtime-internal-client";
import { listWebhookDeliveriesFromRuntime } from "../../../../../../../lib/ma/webhook-deliveries";

export const dynamic = "force-dynamic";

function readLimit(raw: string | null): number {
  if (raw == null || raw === "") return 50;
  if (!/^\d+$/.test(raw)) throw new MaRequestError("limit is invalid");
  const value = Number(raw);
  if (value < 1 || value > 200) throw new MaRequestError("limit is invalid");
  return value;
}

function runtimeDeliveryFailure(error: unknown): NextResponse | null {
  if (error instanceof MaRuntimeUnavailableError || (error instanceof Error && error.name === "MaRuntimeUnavailableError")) {
    return NextResponse.json(
      { error: { code: "runtime_unavailable", message: "runtime unavailable" } },
      { status: 503 },
    );
  }
  if (error instanceof MaRuntimeRequestError || (error instanceof Error && error.name === "MaRuntimeRequestError")) {
    const status = error instanceof MaRuntimeRequestError ? error.status : 502;
    const code = error instanceof MaRuntimeRequestError ? error.code : "internal_error";
    const message = error instanceof Error ? error.message : "runtime request failed";
    return NextResponse.json({ error: { code, message } }, { status });
  }
  return null;
}

export async function GET(request: Request, context: { params: Promise<{ webhookId: string }> }) {
  const auth = await requireMaPat(request, "ma:webhooks:read");
  if (!auth.ok) return auth.response;
  try {
    const { webhookId } = await context.params;
    if (!ULID_RE.test(webhookId)) return maError("webhook_not_found", "webhook not found");
    const limit = readLimit(new URL(request.url).searchParams.get("limit"));
    const deliveries = await listWebhookDeliveriesFromRuntime(auth.identity.tenantId, webhookId, limit);
    return NextResponse.json({ data: deliveries });
  } catch (error) {
    return runtimeDeliveryFailure(error) ?? maErrorFromException(error);
  }
}
