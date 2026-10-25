import { NextResponse } from "next/server";
import { archiveMaCredential } from "@agenticx/iam-core";

import { requireAdminScope } from "../../../../../../../../lib/admin-auth";
import { toCredentialRecord } from "../../../../../../../../lib/ma/vault-records";
import { requiredTenantId, vaultErrorResponse } from "../../../../shared";

export const dynamic = "force-dynamic";

export async function POST(request: Request, context: { params: Promise<{ vaultId: string; credentialId: string }> }) {
  const auth = await requireAdminScope(["provider:update"]);
  if (!auth.ok) return auth.response;
  try {
    const { vaultId, credentialId } = await context.params;
    const credential = await archiveMaCredential(requiredTenantId(), vaultId, credentialId, auth.session.userId);
    return NextResponse.json({ code: "00000", message: "ok", data: { credential: toCredentialRecord(credential) } });
  } catch (error) {
    return vaultErrorResponse(error);
  }
}
