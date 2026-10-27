import { NextResponse } from "next/server";
import { validateVaultIds } from "@agenticx/iam-core";

import { maError, maErrorFromException } from "../../../../../../lib/ma/errors";
import { assertOnlyKeys, readJsonObject, TENANT_ID_RE } from "../../../../../../lib/ma/http";
import { isMaInternalAuthorized, maInternalUnauthorized } from "../../../../../../lib/ma/internal-auth";
import { noStore, readStringList } from "../../../../../../lib/ma/vault-input";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!isMaInternalAuthorized(request)) return noStore(maInternalUnauthorized());
  try {
    const body = await readJsonObject(request);
    assertOnlyKeys(body, ["tenant_id", "vault_ids"]);
    const tenantId = typeof body.tenant_id === "string" ? body.tenant_id : "";
    if (!TENANT_ID_RE.test(tenantId)) return noStore(maError("invalid_request", "tenant_id is required"));
    const vaultIds = readStringList(body.vault_ids, "vault_ids", 20);
    const vaults = await validateVaultIds(tenantId, vaultIds);
    return noStore(NextResponse.json({ vaults }));
  } catch (error) {
    return noStore(maErrorFromException(error));
  }
}
