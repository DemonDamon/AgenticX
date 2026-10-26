import { NextResponse } from "next/server";
import { deleteMaVault, getMaVault, updateMaVault } from "@agenticx/iam-core";

import { maError, maErrorFromException } from "../../../../../../lib/ma/errors";
import { assertOnlyKeys, readJsonObject, ULID_RE } from "../../../../../../lib/ma/http";
import { requireMaPat } from "../../../../../../lib/ma/pat-auth";
import { noStore } from "../../../../../../lib/ma/vault-input";
import { toVaultRecord } from "../../../../../../lib/ma/vault-records";
import { emitMaResourceEvent } from "../../../../../../lib/ma/webhook-events";

export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ vaultId: string }> }) {
  const auth = await requireMaPat(request, "ma:vaults:read");
  if (!auth.ok) return noStore(auth.response);
  try {
    const { vaultId } = await context.params;
    if (!ULID_RE.test(vaultId)) return noStore(maError("vault_not_found", "vault not found"));
    const vault = await getMaVault(auth.identity.tenantId, vaultId);
    return noStore(NextResponse.json({ vault: toVaultRecord(vault) }));
  } catch (error) {
    return noStore(maErrorFromException(error));
  }
}

export async function PATCH(request: Request, context: { params: Promise<{ vaultId: string }> }) {
  const auth = await requireMaPat(request, "ma:vaults:write");
  if (!auth.ok) return noStore(auth.response);
  try {
    const { vaultId } = await context.params;
    if (!ULID_RE.test(vaultId)) return noStore(maError("vault_not_found", "vault not found"));
    const body = await readJsonObject(request);
    assertOnlyKeys(body, ["display_name", "description", "metadata"]);
    const vault = await updateMaVault(auth.identity.tenantId, vaultId, body, auth.identity.userId);
    return noStore(NextResponse.json({ vault: toVaultRecord(vault) }));
  } catch (error) {
    return noStore(maErrorFromException(error));
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ vaultId: string }> }) {
  const auth = await requireMaPat(request, "ma:vaults:write");
  if (!auth.ok) return noStore(auth.response);
  try {
    const { vaultId } = await context.params;
    if (!ULID_RE.test(vaultId)) return noStore(maError("vault_not_found", "vault not found"));
    await deleteMaVault(auth.identity.tenantId, vaultId, auth.identity.userId);
    emitMaResourceEvent({ tenantId: auth.identity.tenantId, type: "vault.deleted", resourceId: vaultId });
    return noStore(NextResponse.json({ id: vaultId, deleted: true }));
  } catch (error) {
    return noStore(maErrorFromException(error));
  }
}
