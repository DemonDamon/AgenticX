import { NextResponse } from "next/server";
import { validateMemoryStoreIds } from "@agenticx/iam-core";

import { maError, maErrorFromException } from "../../../../../../lib/ma/errors";
import { assertOnlyKeys, readJsonObject, TENANT_ID_RE } from "../../../../../../lib/ma/http";
import { isMaInternalAuthorized, maInternalUnauthorized } from "../../../../../../lib/ma/internal-auth";
import { memoryInternalDisabledResponse } from "../../../../../../lib/ma/memory-records";
import { noStore, readStringList } from "../../../../../../lib/ma/vault-input";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!isMaInternalAuthorized(request)) return noStore(maInternalUnauthorized());
  const disabled = memoryInternalDisabledResponse();
  if (disabled) return disabled;
  try {
    const body = await readJsonObject(request);
    assertOnlyKeys(body, ["tenant_id", "memory_store_ids"]);
    const tenantId = typeof body.tenant_id === "string" ? body.tenant_id : "";
    if (!TENANT_ID_RE.test(tenantId)) return noStore(maError("invalid_request", "tenant_id is required"));
    const memoryStoreIds = readStringList(body.memory_store_ids, "memory_store_ids", 8);
    const memoryStores = await validateMemoryStoreIds(tenantId, memoryStoreIds);
    return noStore(NextResponse.json({ memory_stores: memoryStores }));
  } catch (error) {
    return noStore(maErrorFromException(error));
  }
}
