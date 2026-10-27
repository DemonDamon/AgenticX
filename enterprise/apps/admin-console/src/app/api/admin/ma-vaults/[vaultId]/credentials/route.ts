import { NextResponse } from "next/server";
import { createMaCredential, listMaCredentials } from "@agenticx/iam-core";

import { requireAdminScope } from "../../../../../../lib/admin-auth";
import { readIncludeArchived } from "../../../../../../lib/ma/vault-input";
import { toCredentialRecord } from "../../../../../../lib/ma/vault-records";
import { emitMaResourceEvent } from "../../../../../../lib/ma/webhook-events";
import { assertAdminKeys, readAdminJson, requiredTenantId, vaultErrorResponse } from "../../shared";

export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ vaultId: string }> }) {
  const auth = await requireAdminScope(["provider:read"]);
  if (!auth.ok) return auth.response;
  try {
    const { vaultId } = await context.params;
    const credentials = await listMaCredentials(requiredTenantId(), vaultId, {
      includeArchived: readIncludeArchived(new URL(request.url)),
    });
    return NextResponse.json({ code: "00000", message: "ok", data: { credentials: credentials.map(toCredentialRecord) } });
  } catch (error) {
    return vaultErrorResponse(error);
  }
}

export async function POST(request: Request, context: { params: Promise<{ vaultId: string }> }) {
  const auth = await requireAdminScope(["provider:update"]);
  if (!auth.ok) return auth.response;
  try {
    const { vaultId } = await context.params;
    const body = await readAdminJson(request);
    assertAdminKeys(body, ["display_name", "auth"]);
    const credential = await createMaCredential(requiredTenantId(), vaultId, body, auth.session.userId);
    emitMaResourceEvent({
      tenantId: requiredTenantId(),
      type: "vault_credential.created",
      resourceId: credential.id,
      extra: { vault_id: vaultId },
    });
    return NextResponse.json({ code: "00000", message: "ok", data: { credential: toCredentialRecord(credential) } });
  } catch (error) {
    return vaultErrorResponse(error);
  }
}
