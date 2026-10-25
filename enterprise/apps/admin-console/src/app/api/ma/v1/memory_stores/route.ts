import { NextResponse } from "next/server";
import { createMemoryStore, listMemoryStores } from "@agenticx/iam-core";

import { maErrorFromException } from "../../../../../lib/ma/errors";
import { assertOnlyKeys, readJsonObject } from "../../../../../lib/ma/http";
import { toMemoryStoreRecord } from "../../../../../lib/ma/memory-records";
import { requireMaPat } from "../../../../../lib/ma/pat-auth";
import { noStore, readIncludeArchived } from "../../../../../lib/ma/vault-input";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const auth = await requireMaPat(request, "ma:memory:read");
  if (!auth.ok) return noStore(auth.response);
  try {
    const stores = await listMemoryStores(auth.identity.tenantId, {
      includeArchived: readIncludeArchived(new URL(request.url)),
    });
    return noStore(NextResponse.json({ data: stores.map(toMemoryStoreRecord) }));
  } catch (error) {
    return noStore(maErrorFromException(error));
  }
}

export async function POST(request: Request) {
  const auth = await requireMaPat(request, "ma:memory:write");
  if (!auth.ok) return noStore(auth.response);
  try {
    const body = await readJsonObject(request);
    assertOnlyKeys(body, ["name", "description", "metadata"]);
    const store = await createMemoryStore(auth.identity.tenantId, body, auth.identity.userId);
    return noStore(NextResponse.json({ memory_store: toMemoryStoreRecord(store) }, { status: 201 }));
  } catch (error) {
    return noStore(maErrorFromException(error));
  }
}
