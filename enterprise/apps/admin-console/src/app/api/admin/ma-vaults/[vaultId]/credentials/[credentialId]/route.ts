import { NextResponse } from "next/server";
import { deleteMaCredential, getMaCredential, rotateMaCredential } from "@agenticx/iam-core";

import { requireAdminScope } from "../../../../../../../lib/admin-auth";
import { toCredentialRecord } from "../../../../../../../lib/ma/vault-records";
import { assertAdminKeys, readAdminJson, requiredTenantId, vaultErrorResponse } from "../../../shared";

export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ vaultId: string; credentialId: string }> }) {
  const auth = await requireAdminScope(["provider:read"]);
  if (!auth.ok) return auth.response;
  try {
    const { vaultId, credentialId } = await context.params;
    const credential = await getMaCredential(requiredTenantId(), vaultId, credentialId);
    return NextResponse.json({ code: "00000", message: "ok", data: { credential: toCredentialRecord(credential) } });
  } catch (error) {
    return vaultErrorResponse(error);
  }
}

export async function PATCH(request: Request, context: { params: Promise<{ vaultId: string; credentialId: string }> }) {
  const auth = await requireAdminScope(["provider:update"]);
  if (!auth.ok) return auth.response;
  try {
    const { vaultId, credentialId } = await context.params;
    const body = await readAdminJson(request);
    assertAdminKeys(body, ["display_name", "auth"]);
    const credential = await rotateMaCredential(requiredTenantId(), vaultId, credentialId, body, auth.session.userId);
    return NextResponse.json({ code: "00000", message: "ok", data: { credential: toCredentialRecord(credential) } });
  } catch (error) {
    return vaultErrorResponse(error);
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ vaultId: string; credentialId: string }> }) {
  const auth = await requireAdminScope(["provider:delete"]);
  if (!auth.ok) return auth.response;
  try {
    const { vaultId, credentialId } = await context.params;
    await deleteMaCredential(requiredTenantId(), vaultId, credentialId, auth.session.userId);
    return NextResponse.json({ code: "00000", message: "ok", data: { id: credentialId, deleted: true } });
  } catch (error) {
    return vaultErrorResponse(error);
  }
}
