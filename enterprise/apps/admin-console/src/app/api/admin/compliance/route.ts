import { NextResponse } from "next/server";
import { getComplianceConfig, upsertComplianceConfig } from "@agenticx/iam-core";
import { requireAdminScope, requireAdminSomeScope } from "../../../../lib/admin-auth";

export async function GET() {
  const guard = await requireAdminSomeScope(["audit:read", "audit:read:all", "audit:read:dept", "audit:manage"]);
  if (!guard.ok) return guard.response;
  const tenantId = process.env.DEFAULT_TENANT_ID?.trim();
  if (!tenantId) {
    return NextResponse.json({ code: "50000", message: "DEFAULT_TENANT_ID missing" }, { status: 500 });
  }
  return NextResponse.json({
    code: "00000",
    message: "ok",
    data: { config: await getComplianceConfig(tenantId) },
  });
}

export async function PUT(request: Request) {
  const guard = await requireAdminScope(["audit:manage"]);
  if (!guard.ok) return guard.response;
  const tenantId = process.env.DEFAULT_TENANT_ID?.trim();
  if (!tenantId) {
    return NextResponse.json({ code: "50000", message: "DEFAULT_TENANT_ID missing" }, { status: 500 });
  }
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ code: "40001", message: "invalid json" }, { status: 400 });
  }
  const actionRaw = String(body.crossBorderAction ?? "allow").trim().toLowerCase();
  const crossBorderAction =
    actionRaw === "block" || actionRaw === "require_approval" ? actionRaw : ("allow" as const);
  const config = await upsertComplianceConfig({
    tenantId,
    dataResidency: typeof body.dataResidency === "string" ? body.dataResidency : null,
    crossBorderAction,
    auditRetentionYears: Number(body.auditRetentionYears ?? 6),
    appendOnly: body.appendOnly !== false,
  });
  return NextResponse.json({ code: "00000", message: "ok", data: { config } });
}
