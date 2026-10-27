import { NextResponse } from "next/server";

import { requireAdminScope } from "../../../../../../lib/admin-auth";
import { MaRequestError } from "../../../../../../lib/ma/http";
import { MaRuntimeRequestError, MaRuntimeUnavailableError } from "../../../../../../lib/ma/runtime-internal-client";
import { listWebhookDeliveriesFromRuntime } from "../../../../../../lib/ma/webhook-deliveries";
import { automationErrorResponse, ok, requiredTenantId } from "../../../ma-schedules/shared";

export const dynamic = "force-dynamic";

const RUNTIME_UNAVAILABLE_MESSAGE = "运行时不可达，暂时无法读取投递记录";

function readLimit(raw: string | null): number {
  if (raw == null || raw === "") return 50;
  if (!/^\d+$/.test(raw)) throw new MaRequestError("limit is invalid");
  const value = Number(raw);
  if (value < 1 || value > 200) throw new MaRequestError("limit is invalid");
  return value;
}

function runtimeDeliveryFailure(error: unknown): NextResponse | null {
  if (error instanceof MaRuntimeUnavailableError || (error instanceof Error && error.name === "MaRuntimeUnavailableError")) {
    return NextResponse.json({ code: "50300", message: RUNTIME_UNAVAILABLE_MESSAGE }, { status: 503 });
  }
  if (error instanceof MaRuntimeRequestError || (error instanceof Error && error.name === "MaRuntimeRequestError")) {
    const status = error instanceof MaRuntimeRequestError ? error.status : 502;
    const message = error instanceof Error ? error.message : "runtime request failed";
    return NextResponse.json({ code: `${status}00`, message }, { status });
  }
  return null;
}

export async function GET(request: Request, context: { params: Promise<{ webhookId: string }> }) {
  const auth = await requireAdminScope(["provider:read"]);
  if (!auth.ok) return auth.response;
  try {
    const { webhookId } = await context.params;
    const deliveries = await listWebhookDeliveriesFromRuntime(
      requiredTenantId(),
      webhookId,
      readLimit(new URL(request.url).searchParams.get("limit")),
    );
    return ok({ deliveries });
  } catch (error) {
    return runtimeDeliveryFailure(error) ?? automationErrorResponse(error);
  }
}
