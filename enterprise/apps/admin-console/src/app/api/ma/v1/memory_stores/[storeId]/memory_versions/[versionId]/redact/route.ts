import { NextResponse } from "next/server";
import { redactMemoryVersion } from "@agenticx/iam-core";

import { maError, maErrorFromException } from "../../../../../../../../../lib/ma/errors";
import { ULID_RE } from "../../../../../../../../../lib/ma/http";
import { toMemoryVersionRecord } from "../../../../../../../../../lib/ma/memory-records";
import { requireMaPat } from "../../../../../../../../../lib/ma/pat-auth";
import { noStore } from "../../../../../../../../../lib/ma/vault-input";

export const dynamic = "force-dynamic";

export async function POST(request: Request, context: { params: Promise<{ storeId: string; versionId: string }> }) {
  const auth = await requireMaPat(request, "ma:memory:write");
  if (!auth.ok) return noStore(auth.response);
  try {
    const { storeId, versionId } = await context.params;
    if (!ULID_RE.test(versionId)) return noStore(maError("memory_not_found", "memory not found"));
    const version = await redactMemoryVersion(auth.identity.tenantId, storeId, versionId, auth.identity.userId);
    return noStore(NextResponse.json({ memory_version: toMemoryVersionRecord(version, true) }));
  } catch (error) {
    return noStore(maErrorFromException(error));
  }
}
