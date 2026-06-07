import { NextResponse } from "next/server";
import {
  getSettlementWebhookConfig,
  listSettlementWebhookEvents,
  setSettlementWebhookConfig,
} from "../../../../../lib/billing-service";
import { requireAdminScope } from "../../../../../lib/admin-auth";

export async function GET(request: Request) {
  const guard = await requireAdminScope(["metering:read"]);
  if (!guard.ok) return guard.response;
  const view = new URL(request.url).searchParams.get("view");
  try {
    if (view === "events") {
      const result = await listSettlementWebhookEvents(Number(new URL(request.url).searchParams.get("limit") ?? 50));
      return NextResponse.json(result);
    }
    const result = await getSettlementWebhookConfig();
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ code: "50001", message }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  const guard = await requireAdminScope(["metering:manage"]);
  if (!guard.ok) return guard.response;
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ code: "40001", message: "invalid json" }, { status: 400 });
  }
  try {
    const result = await setSettlementWebhookConfig({
      webhook_url:
        body.webhook_url === undefined ? undefined : typeof body.webhook_url === "string" ? body.webhook_url : null,
      enabled: typeof body.enabled === "boolean" ? body.enabled : undefined,
    });
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ code: "50001", message }, { status: 500 });
  }
}
