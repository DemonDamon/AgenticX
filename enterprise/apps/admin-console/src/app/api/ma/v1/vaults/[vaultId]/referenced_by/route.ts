import { NextResponse } from "next/server";
import { listVaultReferences } from "@agenticx/iam-core";

import { maError, maErrorFromException } from "../../../../../../../lib/ma/errors";
import { ULID_RE } from "../../../../../../../lib/ma/http";
import { requireMaPat } from "../../../../../../../lib/ma/pat-auth";
import { noStore } from "../../../../../../../lib/ma/vault-input";

export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ vaultId: string }> }) {
  const auth = await requireMaPat(request, "ma:vaults:read");
  if (!auth.ok) return noStore(auth.response);
  try {
    const { vaultId } = await context.params;
    if (!ULID_RE.test(vaultId)) return noStore(maError("vault_not_found", "vault not found"));
    const references = await listVaultReferences(auth.identity.tenantId, vaultId);
    return noStore(NextResponse.json(references));
  } catch (error) {
    return noStore(maErrorFromException(error));
  }
}
