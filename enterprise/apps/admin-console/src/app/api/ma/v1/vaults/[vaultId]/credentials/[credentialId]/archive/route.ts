import { NextResponse } from "next/server";
import { archiveMaCredential } from "@agenticx/iam-core";

import { maError, maErrorFromException } from "../../../../../../../../../lib/ma/errors";
import { ULID_RE } from "../../../../../../../../../lib/ma/http";
import { requireMaPat } from "../../../../../../../../../lib/ma/pat-auth";
import { noStore } from "../../../../../../../../../lib/ma/vault-input";
import { toCredentialRecord } from "../../../../../../../../../lib/ma/vault-records";

export const dynamic = "force-dynamic";

export async function POST(request: Request, context: { params: Promise<{ vaultId: string; credentialId: string }> }) {
  const auth = await requireMaPat(request, "ma:vaults:write");
  if (!auth.ok) return noStore(auth.response);
  try {
    const { vaultId, credentialId } = await context.params;
    if (!ULID_RE.test(vaultId)) return noStore(maError("vault_not_found", "vault not found"));
    if (!ULID_RE.test(credentialId)) return noStore(maError("credential_not_found", "credential not found"));
    const credential = await archiveMaCredential(auth.identity.tenantId, vaultId, credentialId, auth.identity.userId);
    return noStore(NextResponse.json({ credential: toCredentialRecord(credential) }));
  } catch (error) {
    return noStore(maErrorFromException(error));
  }
}
