import { NextResponse } from "next/server";
import { createMemoryStore, listMemoryStores } from "@agenticx/iam-core";

import { requireAdminScope } from "../../../../lib/admin-auth";
import { toMemoryStoreRecord } from "../../../../lib/ma/memory-records";
import { readIncludeArchived } from "../../../../lib/ma/vault-input";
import { assertAdminKeys, memoryErrorResponse, readAdminJson, requiredTenantId } from "./shared";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const auth = await requireAdminScope(["kb:read"]);
  if (!auth.ok) return auth.response;
  try {
    const stores = await listMemoryStores(requiredTenantId(), {
      includeArchived: readIncludeArchived(new URL(request.url)),
    });
    return NextResponse.json({ code: "00000", message: "ok", data: { memory_stores: stores.map(toMemoryStoreRecord) } });
  } catch (error) {
    return memoryErrorResponse(error);
  }
}

export async function POST(request: Request) {
  const auth = await requireAdminScope(["kb:update"]);
  if (!auth.ok) return auth.response;
  try {
    const body = await readAdminJson(request);
    assertAdminKeys(body, ["name", "description", "metadata"]);
    const store = await createMemoryStore(requiredTenantId(), body, auth.session.userId);
    return NextResponse.json({ code: "00000", message: "ok", data: { memory_store: toMemoryStoreRecord(store) } });
  } catch (error) {
    return memoryErrorResponse(error);
  }
}
