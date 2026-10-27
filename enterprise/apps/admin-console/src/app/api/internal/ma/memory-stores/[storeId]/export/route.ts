import { NextResponse } from "next/server";
import { exportMemoryStoreForDream } from "@agenticx/iam-core";

import { maError, maErrorFromException } from "../../../../../../../lib/ma/errors";
import { TENANT_ID_RE } from "../../../../../../../lib/ma/http";
import { isMaInternalAuthorized, maInternalUnauthorized } from "../../../../../../../lib/ma/internal-auth";
import { memoryInternalDisabledResponse } from "../../../../../../../lib/ma/memory-records";
import { noStore } from "../../../../../../../lib/ma/vault-input";

export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ storeId: string }> }) {
  if (!isMaInternalAuthorized(request)) return noStore(maInternalUnauthorized());
  const disabled = memoryInternalDisabledResponse();
  if (disabled) return disabled;
  try {
    const { storeId } = await context.params;
    const tenantId = new URL(request.url).searchParams.get("tenant_id") ?? "";
    if (!TENANT_ID_RE.test(tenantId)) return noStore(maError("invalid_request", "tenant_id is required"));
    const exported = await exportMemoryStoreForDream(tenantId, storeId);
    return noStore(
      NextResponse.json({
        memory_store: { id: exported.store.id, name: exported.store.name, status: exported.store.status },
        memories: exported.memories,
      }),
    );
  } catch (error) {
    return noStore(maErrorFromException(error));
  }
}
