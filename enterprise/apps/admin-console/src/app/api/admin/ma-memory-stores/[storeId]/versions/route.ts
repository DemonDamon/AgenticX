import { NextResponse } from "next/server";
import { getMemoryVersion, listMemoryVersions } from "@agenticx/iam-core";

import { requireAdminScope } from "../../../../../../lib/admin-auth";
import { parseVersionListQuery, toMemoryVersionRecord } from "../../../../../../lib/ma/memory-records";
import { memoryErrorResponse, requiredTenantId } from "../../shared";

export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ storeId: string }> }) {
  const auth = await requireAdminScope(["kb:read"]);
  if (!auth.ok) return auth.response;
  try {
    const { storeId } = await context.params;
    const url = new URL(request.url);
    const versionId = url.searchParams.get("version_id");
    if (versionId) {
      const version = await getMemoryVersion(requiredTenantId(), storeId, versionId);
      return NextResponse.json({
        code: "00000",
        message: "ok",
        data: { memory_version: toMemoryVersionRecord(version, true) },
      });
    }
    const query = parseVersionListQuery(url);
    const page = await listMemoryVersions(requiredTenantId(), storeId, query);
    return NextResponse.json({
      code: "00000",
      message: "ok",
      data: {
        items: page.items.map((item) => toMemoryVersionRecord(item, false)),
        next_cursor: page.nextCursor,
      },
    });
  } catch (error) {
    return memoryErrorResponse(error);
  }
}
