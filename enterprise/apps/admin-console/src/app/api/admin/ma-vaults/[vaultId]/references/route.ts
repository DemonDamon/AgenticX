import { NextResponse } from "next/server";
import { listVaultReferences } from "@agenticx/iam-core";

import { requireAdminScope } from "../../../../../../lib/admin-auth";
import { requiredTenantId, vaultErrorResponse } from "../../shared";

export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ vaultId: string }> }) {
  const auth = await requireAdminScope(["provider:read"]);
  if (!auth.ok) return auth.response;
  try {
    const { vaultId } = await context.params;
    const references = await listVaultReferences(requiredTenantId(), vaultId);
    return NextResponse.json({ code: "00000", message: "ok", data: references });
  } catch (error) {
    return vaultErrorResponse(error);
  }
}
