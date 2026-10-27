import { NextResponse } from "next/server";
import { applyMemoryWrite, listMemories } from "@agenticx/iam-core";

import { maErrorFromException } from "../../../../../../../lib/ma/errors";
import { assertOnlyKeys, MaRequestError, readJsonObject } from "../../../../../../../lib/ma/http";
import { memoryWriteFailureResponse, parseMemoryListQuery, publicMemoryListItem, toMemoryRecord } from "../../../../../../../lib/ma/memory-records";
import { requireMaPat } from "../../../../../../../lib/ma/pat-auth";
import { noStore } from "../../../../../../../lib/ma/vault-input";

export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ storeId: string }> }) {
  const auth = await requireMaPat(request, "ma:memory:read");
  if (!auth.ok) return noStore(auth.response);
  try {
    const { storeId } = await context.params;
    const query = parseMemoryListQuery(new URL(request.url));
    const page = await listMemories(auth.identity.tenantId, storeId, query);
    return noStore(
      NextResponse.json({
        data: page.items.map((item) => publicMemoryListItem(item, query.view)),
        next_cursor: page.nextCursor,
      }),
    );
  } catch (error) {
    return noStore(maErrorFromException(error));
  }
}

export async function POST(request: Request, context: { params: Promise<{ storeId: string }> }) {
  const auth = await requireMaPat(request, "ma:memory:write");
  if (!auth.ok) return noStore(auth.response);
  try {
    const { storeId } = await context.params;
    const body = await readJsonObject(request);
    assertOnlyKeys(body, ["path", "content"]);
    if (typeof body.path !== "string" || typeof body.content !== "string") {
      throw new MaRequestError("path and content are required");
    }
    const result = await applyMemoryWrite(
      auth.identity.tenantId,
      storeId,
      { op: "create", path: body.path, content: body.content },
      { kind: "user", userId: auth.identity.userId },
    );
    if (!result.ok) return noStore(memoryWriteFailureResponse(result));
    if (!result.memory) return noStore(maErrorFromException(new Error("memory was not created")));
    return noStore(NextResponse.json({ memory: toMemoryRecord(result.memory, true) }, { status: 201 }));
  } catch (error) {
    return noStore(maErrorFromException(error));
  }
}
