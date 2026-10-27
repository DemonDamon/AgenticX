import { QuotaTimeZoneError } from "@agenticx/feature-metering";
import { MaAgentQuotaValidationError } from "@agenticx/iam-core";
import { NextResponse } from "next/server";

import { requireAdminScope } from "../../../../../lib/admin-auth";
import { listAgentQuotaView, saveAgentQuota } from "../../../../../lib/metering-service";

const ULID_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/;

function quotaError(error: unknown): NextResponse | null {
  if (error instanceof MaAgentQuotaValidationError || (error instanceof Error && error.name === "MaAgentQuotaValidationError")) {
    return NextResponse.json({ code: "40001", message: error.message }, { status: 400 });
  }
  if (error instanceof QuotaTimeZoneError || (error instanceof Error && error.name === "QuotaTimeZoneError")) {
    return NextResponse.json({ code: "50001", message: error.message }, { status: 500 });
  }
  return null;
}

export async function GET(request: Request) {
  const guard = await requireAdminScope(["metering:read"]);
  if (!guard.ok) return guard.response;
  const agentId = new URL(request.url).searchParams.get("agent_id")?.trim() ?? "";
  if (!ULID_RE.test(agentId)) {
    return NextResponse.json({ code: "40001", message: "agent_id: is invalid" }, { status: 400 });
  }
  try {
    const data = await listAgentQuotaView(agentId);
    return NextResponse.json({ code: "00000", message: "ok", data });
  } catch (error) {
    const mapped = quotaError(error);
    if (mapped) return mapped;
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
    return NextResponse.json({ code: "40001", message: "body: invalid json" }, { status: 400 });
  }
  try {
    const rule = await saveAgentQuota(body, guard.session.userId);
    return NextResponse.json({ code: "00000", message: "ok", data: { rule } });
  } catch (error) {
    const mapped = quotaError(error);
    if (mapped) return mapped;
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ code: "50001", message }, { status: 500 });
  }
}
