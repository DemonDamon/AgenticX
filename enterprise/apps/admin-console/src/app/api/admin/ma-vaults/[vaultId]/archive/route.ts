import { NextResponse } from "next/server";
import { archiveMaVault } from "@agenticx/iam-core";

import { requireAdminScope } from "../../../../../../lib/admin-auth";
import { toVaultRecord } from "../../../../../../lib/ma/vault-records";
import { requiredTenantId, vaultErrorResponse } from "../../shared";

export const dynamic = "force-dynamic";

export async function POST(request: Request, context: { params: Promise<{ vaultId: string }> }) {
  const auth = await requireAdminScope(["provider:update"]);
  if (!auth.ok) return auth.response;
  try {
    const { vaultId } = await context.params;
    const vault = await archiveMaVault(requiredTenantId(), vaultId, auth.session.userId);
    return NextResponse.json({ code: "00000", message: "ok", data: { vault: toVaultRecord(vault) } });
  } catch (error) {
    return vaultErrorResponse(error);
  }
}
