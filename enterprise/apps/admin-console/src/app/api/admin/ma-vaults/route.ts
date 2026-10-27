import { NextResponse } from "next/server";
import { createMaVault, listMaVaults } from "@agenticx/iam-core";

import { requireAdminScope } from "../../../../lib/admin-auth";
import { readIncludeArchived } from "../../../../lib/ma/vault-input";
import { toVaultRecord } from "../../../../lib/ma/vault-records";
import { emitMaResourceEvent } from "../../../../lib/ma/webhook-events";
import { assertAdminKeys, readAdminJson, requiredTenantId, vaultErrorResponse } from "./shared";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const auth = await requireAdminScope(["provider:read"]);
  if (!auth.ok) return auth.response;
  try {
    const vaults = await listMaVaults(requiredTenantId(), { includeArchived: readIncludeArchived(new URL(request.url)) });
    return NextResponse.json({ code: "00000", message: "ok", data: { vaults: vaults.map(toVaultRecord) } });
  } catch (error) {
    return vaultErrorResponse(error);
  }
}

export async function POST(request: Request) {
  const auth = await requireAdminScope(["provider:update"]);
  if (!auth.ok) return auth.response;
  try {
    const body = await readAdminJson(request);
    assertAdminKeys(body, ["display_name", "description", "metadata"]);
    const vault = await createMaVault(requiredTenantId(), body, auth.session.userId);
    emitMaResourceEvent({ tenantId: requiredTenantId(), type: "vault.created", resourceId: vault.id });
    return NextResponse.json({ code: "00000", message: "ok", data: { vault: toVaultRecord(vault) } });
  } catch (error) {
    return vaultErrorResponse(error);
  }
}
