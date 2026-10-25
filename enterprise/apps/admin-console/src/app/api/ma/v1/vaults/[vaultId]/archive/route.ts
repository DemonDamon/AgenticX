import { NextResponse } from "next/server";
import { archiveMaVault } from "@agenticx/iam-core";

import { maError, maErrorFromException } from "../../../../../../../lib/ma/errors";
import { ULID_RE } from "../../../../../../../lib/ma/http";
import { requireMaPat } from "../../../../../../../lib/ma/pat-auth";
import { noStore } from "../../../../../../../lib/ma/vault-input";
import { toVaultRecord } from "../../../../../../../lib/ma/vault-records";

export const dynamic = "force-dynamic";

export async function POST(request: Request, context: { params: Promise<{ vaultId: string }> }) {
  const auth = await requireMaPat(request, "ma:vaults:write");
  if (!auth.ok) return noStore(auth.response);
  try {
    const { vaultId } = await context.params;
    if (!ULID_RE.test(vaultId)) return noStore(maError("vault_not_found", "vault not found"));
    const vault = await archiveMaVault(auth.identity.tenantId, vaultId, auth.identity.userId);
    return noStore(NextResponse.json({ vault: toVaultRecord(vault) }));
  } catch (error) {
    return noStore(maErrorFromException(error));
  }
}
