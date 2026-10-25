import { NextResponse } from "next/server";
import { archiveMemoryStore } from "@agenticx/iam-core";

import { requireAdminScope } from "../../../../../../lib/admin-auth";
import { toMemoryStoreRecord } from "../../../../../../lib/ma/memory-records";
import { memoryErrorResponse, requiredTenantId } from "../../shared";

export const dynamic = "force-dynamic";

export async function POST(_request: Request, context: { params: Promise<{ storeId: string }> }) {
  const auth = await requireAdminScope(["kb:update"]);
  if (!auth.ok) return auth.response;
  try {
    const { storeId } = await context.params;
    const store = await archiveMemoryStore(requiredTenantId(), storeId, auth.session.userId);
    return NextResponse.json({ code: "00000", message: "ok", data: { memory_store: toMemoryStoreRecord(store) } });
  } catch (error) {
    return memoryErrorResponse(error);
  }
}
