import { NextResponse } from "next/server";
import { redactMemoryVersion } from "@agenticx/iam-core";

import { requireAdminScope } from "../../../../../../../../lib/admin-auth";
import { toMemoryVersionRecord } from "../../../../../../../../lib/ma/memory-records";
import { memoryErrorResponse, requiredTenantId } from "../../../../shared";

export const dynamic = "force-dynamic";

export async function POST(_request: Request, context: { params: Promise<{ storeId: string; versionId: string }> }) {
  const auth = await requireAdminScope(["kb:delete"]);
  if (!auth.ok) return auth.response;
  try {
    const { storeId, versionId } = await context.params;
    const version = await redactMemoryVersion(requiredTenantId(), storeId, versionId, auth.session.userId);
    return NextResponse.json({
      code: "00000",
      message: "ok",
      data: { memory_version: toMemoryVersionRecord(version, true) },
    });
  } catch (error) {
    return memoryErrorResponse(error);
  }
}
