import { NextResponse } from "next/server";
import { deleteMaCredential, getMaCredential, rotateMaCredential } from "@agenticx/iam-core";

import { maError, maErrorFromException } from "../../../../../../../../lib/ma/errors";
import { assertOnlyKeys, readJsonObject, ULID_RE } from "../../../../../../../../lib/ma/http";
import { requireMaPat } from "../../../../../../../../lib/ma/pat-auth";
import { noStore } from "../../../../../../../../lib/ma/vault-input";
import { toCredentialRecord } from "../../../../../../../../lib/ma/vault-records";
import { emitMaResourceEvent } from "../../../../../../../../lib/ma/webhook-events";

export const dynamic = "force-dynamic";

function missing(vaultId: string, credentialId: string): NextResponse | null {
  if (!ULID_RE.test(vaultId)) return noStore(maError("vault_not_found", "vault not found"));
  if (!ULID_RE.test(credentialId)) return noStore(maError("credential_not_found", "credential not found"));
  return null;
}

export async function GET(request: Request, context: { params: Promise<{ vaultId: string; credentialId: string }> }) {
  const auth = await requireMaPat(request, "ma:vaults:read");
  if (!auth.ok) return noStore(auth.response);
  try {
    const { vaultId, credentialId } = await context.params;
    const invalid = missing(vaultId, credentialId);
    if (invalid) return invalid;
    const credential = await getMaCredential(auth.identity.tenantId, vaultId, credentialId);
    return noStore(NextResponse.json({ credential: toCredentialRecord(credential) }));
  } catch (error) {
    return noStore(maErrorFromException(error));
  }
}

export async function PATCH(request: Request, context: { params: Promise<{ vaultId: string; credentialId: string }> }) {
  const auth = await requireMaPat(request, "ma:vaults:write");
  if (!auth.ok) return noStore(auth.response);
  try {
    const { vaultId, credentialId } = await context.params;
    const invalid = missing(vaultId, credentialId);
    if (invalid) return invalid;
    const body = await readJsonObject(request);
    assertOnlyKeys(body, ["display_name", "auth"]);
    const credential = await rotateMaCredential(auth.identity.tenantId, vaultId, credentialId, body, auth.identity.userId);
    return noStore(NextResponse.json({ credential: toCredentialRecord(credential) }));
  } catch (error) {
    return noStore(maErrorFromException(error));
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ vaultId: string; credentialId: string }> }) {
  const auth = await requireMaPat(request, "ma:vaults:write");
  if (!auth.ok) return noStore(auth.response);
  try {
    const { vaultId, credentialId } = await context.params;
    const invalid = missing(vaultId, credentialId);
    if (invalid) return invalid;
    await deleteMaCredential(auth.identity.tenantId, vaultId, credentialId, auth.identity.userId);
    emitMaResourceEvent({
      tenantId: auth.identity.tenantId,
      type: "vault_credential.deleted",
      resourceId: credentialId,
      extra: { vault_id: vaultId },
    });
    return noStore(NextResponse.json({ id: credentialId, deleted: true }));
  } catch (error) {
    return noStore(maErrorFromException(error));
  }
}
