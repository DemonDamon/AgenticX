import { NextResponse } from "next/server";
import { listMemoryVersions } from "@agenticx/iam-core";

import { maErrorFromException } from "../../../../../../../lib/ma/errors";
import { parseVersionListQuery, toMemoryVersionRecord } from "../../../../../../../lib/ma/memory-records";
import { requireMaPat } from "../../../../../../../lib/ma/pat-auth";
import { noStore } from "../../../../../../../lib/ma/vault-input";

export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ storeId: string }> }) {
  const auth = await requireMaPat(request, "ma:memory:read");
  if (!auth.ok) return noStore(auth.response);
  try {
    const { storeId } = await context.params;
    const query = parseVersionListQuery(new URL(request.url));
    const page = await listMemoryVersions(auth.identity.tenantId, storeId, query);
    return noStore(
      NextResponse.json({
        data: page.items.map((item) => toMemoryVersionRecord(item, false)),
        next_cursor: page.nextCursor,
      }),
    );
  } catch (error) {
    return noStore(maErrorFromException(error));
  }
}
