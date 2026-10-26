import { NextResponse } from "next/server";
import { deleteMaVault, getMaVault, updateMaVault } from "@agenticx/iam-core";

import { requireAdminScope } from "../../../../../lib/admin-auth";
import { toVaultRecord } from "../../../../../lib/ma/vault-records";
import { emitMaResourceEvent } from "../../../../../lib/ma/webhook-events";
import { assertAdminKeys, readAdminJson, requiredTenantId, vaultErrorResponse } from "../shared";

export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ vaultId: string }> }) {
  const auth = await requireAdminScope(["provider:read"]);
  if (!auth.ok) return auth.response;
  try {
    const { vaultId } = await context.params;
    const vault = await getMaVault(requiredTenantId(), vaultId);
    return NextResponse.json({ code: "00000", message: "ok", data: { vault: toVaultRecord(vault) } });
  } catch (error) {
    return vaultErrorResponse(error);
  }
}

export async function PATCH(request: Request, context: { params: Promise<{ vaultId: string }> }) {
  const auth = await requireAdminScope(["provider:update"]);
  if (!auth.ok) return auth.response;
  try {
    const { vaultId } = await context.params;
    const body = await readAdminJson(request);
    assertAdminKeys(body, ["display_name", "description", "metadata"]);
    const vault = await updateMaVault(requiredTenantId(), vaultId, body, auth.session.userId);
    return NextResponse.json({ code: "00000", message: "ok", data: { vault: toVaultRecord(vault) } });
  } catch (error) {
    return vaultErrorResponse(error);
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ vaultId: string }> }) {
  const auth = await requireAdminScope(["provider:delete"]);
  if (!auth.ok) return auth.response;
  try {
    const { vaultId } = await context.params;
    await deleteMaVault(requiredTenantId(), vaultId, auth.session.userId);
    emitMaResourceEvent({ tenantId: requiredTenantId(), type: "vault.deleted", resourceId: vaultId });
    return NextResponse.json({ code: "00000", message: "ok", data: { id: vaultId, deleted: true } });
  } catch (error) {
    return vaultErrorResponse(error);
  }
}
