import { NextResponse } from "next/server";
import {
  readAlertChannels,
  readTenantAlertChannels,
  writeTenantAlertChannels,
  deleteTenantAlertChannels,
  type TenantAlertChannels,
} from "../../../../../lib/alert-channels-store";
import { requireAdminScope } from "../../../../../lib/admin-auth";

export async function GET(request: Request) {
  const guard = await requireAdminScope(["audit:read"]);
  if (!guard.ok) {
    return guard.response;
  }
  const tenantId = new URL(request.url).searchParams.get("tenant")?.trim();
  if (tenantId) {
    const tenant = await readTenantAlertChannels(tenantId);
    return NextResponse.json({ code: "00000", message: "ok", data: tenant });
  }
  const config = await readAlertChannels();
  return NextResponse.json({ code: "00000", message: "ok", data: config });
}

export async function PUT(request: Request) {
  const guard = await requireAdminScope(["audit:manage"]);
  if (!guard.ok) {
    return guard.response;
  }
  let body: { tenantId?: string; config?: TenantAlertChannels };
  try {
    body = (await request.json()) as { tenantId?: string; config?: TenantAlertChannels };
  } catch {
    return NextResponse.json({ code: "40001", message: "invalid json" }, { status: 400 });
  }
  const tenantId = body.tenantId?.trim();
  if (!tenantId) {
    return NextResponse.json({ code: "40001", message: "tenantId is required" }, { status: 400 });
  }
  if (!body.config) {
    return NextResponse.json({ code: "40001", message: "config is required" }, { status: 400 });
  }
  try {
    await writeTenantAlertChannels(tenantId, body.config);
  } catch (err) {
    const message = err instanceof Error ? err.message : "invalid config";
    return NextResponse.json({ code: "40001", message }, { status: 400 });
  }
  // 网关 10s 内轮询到新配置，无需显式 reload。
  return NextResponse.json({ code: "00000", message: "ok", data: body.config });
}

export async function DELETE(request: Request) {
  const guard = await requireAdminScope(["audit:manage"]);
  if (!guard.ok) {
    return guard.response;
  }
  const tenantId = new URL(request.url).searchParams.get("tenant")?.trim();
  if (!tenantId) {
    return NextResponse.json({ code: "40001", message: "tenant is required" }, { status: 400 });
  }
  await deleteTenantAlertChannels(tenantId);
  return NextResponse.json({ code: "00000", message: "ok" });
}
