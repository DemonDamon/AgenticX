import { NextResponse } from "next/server";
import { createMaCredential, listMaCredentials } from "@agenticx/iam-core";

import { maError, maErrorFromException } from "../../../../../../../lib/ma/errors";
import { assertOnlyKeys, readJsonObject, ULID_RE } from "../../../../../../../lib/ma/http";
import { requireMaPat } from "../../../../../../../lib/ma/pat-auth";
import { noStore, readIncludeArchived } from "../../../../../../../lib/ma/vault-input";
import { toCredentialRecord } from "../../../../../../../lib/ma/vault-records";

export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ vaultId: string }> }) {
  const auth = await requireMaPat(request, "ma:vaults:read");
  if (!auth.ok) return noStore(auth.response);
  try {
    const { vaultId } = await context.params;
    if (!ULID_RE.test(vaultId)) return noStore(maError("vault_not_found", "vault not found"));
    const credentials = await listMaCredentials(auth.identity.tenantId, vaultId, {
      includeArchived: readIncludeArchived(new URL(request.url)),
    });
    return noStore(NextResponse.json({ data: credentials.map(toCredentialRecord) }));
  } catch (error) {
    return noStore(maErrorFromException(error));
  }
}

export async function POST(request: Request, context: { params: Promise<{ vaultId: string }> }) {
  const auth = await requireMaPat(request, "ma:vaults:write");
  if (!auth.ok) return noStore(auth.response);
  try {
    const { vaultId } = await context.params;
    if (!ULID_RE.test(vaultId)) return noStore(maError("vault_not_found", "vault not found"));
    const body = await readJsonObject(request);
    assertOnlyKeys(body, ["display_name", "auth"]);
    const credential = await createMaCredential(auth.identity.tenantId, vaultId, body, auth.identity.userId);
    return noStore(NextResponse.json({ credential: toCredentialRecord(credential) }, { status: 201 }));
  } catch (error) {
    return noStore(maErrorFromException(error));
  }
}
