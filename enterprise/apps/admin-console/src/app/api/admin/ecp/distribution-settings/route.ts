import { NextResponse } from "next/server";

import { requireAdminScope } from "../../../../../lib/admin-auth";
import {
  getEcpTenantDistributionPolicy,
  updateEcpTenantDistributionPolicy,
} from "../../../../../lib/ecp-tenant-settings-store";

export async function GET() {
  const auth = await requireAdminScope(["provider:read"]);
  if (!auth.ok) return auth.response;
  const tenantId = process.env.DEFAULT_TENANT_ID?.trim();
  if (!tenantId) {
    return NextResponse.json({ code: "50000", message: "DEFAULT_TENANT_ID missing" }, { status: 500 });
  }
  const policy = await getEcpTenantDistributionPolicy(tenantId);
  return NextResponse.json({ code: "00000", message: "ok", data: { policy } });
}

export async function PUT(request: Request) {
  const auth = await requireAdminScope(["provider:update"]);
  if (!auth.ok) return auth.response;
  const tenantId = process.env.DEFAULT_TENANT_ID?.trim();
  if (!tenantId) {
    return NextResponse.json({ code: "50000", message: "DEFAULT_TENANT_ID missing" }, { status: 500 });
  }
  const body = (await request.json().catch(() => ({}))) as { installCopyEnabled?: boolean };
  const policy = await updateEcpTenantDistributionPolicy(tenantId, {
    installCopyEnabled: body.installCopyEnabled,
  });
  return NextResponse.json({ code: "00000", message: "ok", data: { policy } });
}
