import { NextResponse } from "next/server";
import { deleteMemoryStore, getMemoryStore, updateMemoryStore } from "@agenticx/iam-core";

import { requireAdminScope } from "../../../../../lib/admin-auth";
import { toMemoryStoreRecord } from "../../../../../lib/ma/memory-records";
import { assertAdminKeys, memoryErrorResponse, readAdminJson, requiredTenantId } from "../shared";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ storeId: string }> }) {
  const auth = await requireAdminScope(["kb:read"]);
  if (!auth.ok) return auth.response;
  try {
    const { storeId } = await context.params;
    const store = await getMemoryStore(requiredTenantId(), storeId);
    return NextResponse.json({ code: "00000", message: "ok", data: { memory_store: toMemoryStoreRecord(store) } });
  } catch (error) {
    return memoryErrorResponse(error);
  }
}

export async function PATCH(request: Request, context: { params: Promise<{ storeId: string }> }) {
  const auth = await requireAdminScope(["kb:update"]);
  if (!auth.ok) return auth.response;
  try {
    const { storeId } = await context.params;
    const body = await readAdminJson(request);
    assertAdminKeys(body, ["name", "description", "metadata"]);
    const store = await updateMemoryStore(requiredTenantId(), storeId, body, auth.session.userId);
    return NextResponse.json({ code: "00000", message: "ok", data: { memory_store: toMemoryStoreRecord(store) } });
  } catch (error) {
    return memoryErrorResponse(error);
  }
}

export async function DELETE(_request: Request, context: { params: Promise<{ storeId: string }> }) {
  const auth = await requireAdminScope(["kb:delete"]);
  if (!auth.ok) return auth.response;
  try {
    const { storeId } = await context.params;
    await deleteMemoryStore(requiredTenantId(), storeId, auth.session.userId);
    return NextResponse.json({ code: "00000", message: "ok", data: { id: storeId, deleted: true } });
  } catch (error) {
    return memoryErrorResponse(error);
  }
}
