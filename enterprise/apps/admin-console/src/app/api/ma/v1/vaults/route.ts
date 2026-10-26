import { NextResponse } from "next/server";
import { createMaVault, listMaVaults } from "@agenticx/iam-core";

import { maErrorFromException } from "../../../../../lib/ma/errors";
import { assertOnlyKeys, readJsonObject } from "../../../../../lib/ma/http";
import { requireMaPat } from "../../../../../lib/ma/pat-auth";
import { noStore, readIncludeArchived } from "../../../../../lib/ma/vault-input";
import { toVaultRecord } from "../../../../../lib/ma/vault-records";
import { emitMaResourceEvent } from "../../../../../lib/ma/webhook-events";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const auth = await requireMaPat(request, "ma:vaults:read");
  if (!auth.ok) return noStore(auth.response);
  try {
    const vaults = await listMaVaults(auth.identity.tenantId, { includeArchived: readIncludeArchived(new URL(request.url)) });
    return noStore(NextResponse.json({ data: vaults.map(toVaultRecord) }));
  } catch (error) {
    return noStore(maErrorFromException(error));
  }
}

export async function POST(request: Request) {
  const auth = await requireMaPat(request, "ma:vaults:write");
  if (!auth.ok) return noStore(auth.response);
  try {
    const body = await readJsonObject(request);
    assertOnlyKeys(body, ["display_name", "description", "metadata"]);
    const vault = await createMaVault(auth.identity.tenantId, body, auth.identity.userId);
    emitMaResourceEvent({ tenantId: auth.identity.tenantId, type: "vault.created", resourceId: vault.id });
    return noStore(NextResponse.json({ vault: toVaultRecord(vault) }, { status: 201 }));
  } catch (error) {
    return noStore(maErrorFromException(error));
  }
}
