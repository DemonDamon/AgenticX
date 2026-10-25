import { NextResponse } from "next/server";
import { archiveMemoryStore } from "@agenticx/iam-core";

import { maError, maErrorFromException } from "../../../../../../../lib/ma/errors";
import { ULID_RE } from "../../../../../../../lib/ma/http";
import { toMemoryStoreRecord } from "../../../../../../../lib/ma/memory-records";
import { requireMaPat } from "../../../../../../../lib/ma/pat-auth";
import { noStore } from "../../../../../../../lib/ma/vault-input";

export const dynamic = "force-dynamic";

export async function POST(request: Request, context: { params: Promise<{ storeId: string }> }) {
  const auth = await requireMaPat(request, "ma:memory:write");
  if (!auth.ok) return noStore(auth.response);
  try {
    const { storeId } = await context.params;
    if (!ULID_RE.test(storeId)) return noStore(maError("memory_store_not_found", "memory store not found"));
    const store = await archiveMemoryStore(auth.identity.tenantId, storeId, auth.identity.userId);
    return noStore(NextResponse.json({ memory_store: toMemoryStoreRecord(store) }));
  } catch (error) {
    return noStore(maErrorFromException(error));
  }
}
