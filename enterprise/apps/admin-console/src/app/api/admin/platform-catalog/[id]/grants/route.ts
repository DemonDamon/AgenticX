import { NextResponse } from "next/server";
import { requireAdminScope } from "../../../../../../lib/admin-auth";
import {
  grantCatalogToTenant,
  revokeCatalogFromTenant,
  type RevokePolicy,
} from "../../../../../../lib/platform-catalog-store";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminScope(["provider:update"]);
  if (!auth.ok) return auth.response;
  const { id: catalogItemId } = await context.params;
  try {
    const body = (await request.json()) as { tenantId?: string };
    const tenantId = body.tenantId?.trim();
    if (!tenantId) {
      return NextResponse.json({ code: "40000", message: "tenantId required" }, { status: 400 });
    }
    const result = await grantCatalogToTenant(catalogItemId, tenantId);
    return NextResponse.json({ code: "00000", message: "ok", data: result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "grant failed";
    const status = message === "catalog item not found" ? 404 : 400;
    return NextResponse.json({ code: status === 404 ? "40400" : "40000", message }, { status });
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminScope(["provider:update"]);
  if (!auth.ok) return auth.response;
  const { id: catalogItemId } = await context.params;
  try {
    const body = (await request.json()) as { tenantId?: string; policy?: RevokePolicy };
    const tenantId = body.tenantId?.trim();
    if (!tenantId) {
      return NextResponse.json({ code: "40000", message: "tenantId required" }, { status: 400 });
    }
    const policy: RevokePolicy =
      body.policy === "strip_bootstrap" ? "strip_bootstrap" : "retain_stop_updates";
    const grant = await revokeCatalogFromTenant(catalogItemId, tenantId, policy);
    return NextResponse.json({ code: "00000", message: "ok", data: { grant } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "revoke failed";
    const status = message === "active grant not found" ? 404 : 400;
    return NextResponse.json({ code: status === 404 ? "40400" : "40000", message }, { status });
  }
}
