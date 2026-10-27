import { NextResponse } from "next/server";
import { setDreamReviewDecision } from "@agenticx/iam-core";

import { requireAdminScope } from "../../../../../../lib/admin-auth";
import { toMemoryStoreRecord } from "../../../../../../lib/ma/memory-records";
import { assertAdminKeys, memoryErrorResponse, readAdminJson, requiredTenantId } from "../../shared";

export const dynamic = "force-dynamic";

export async function POST(request: Request, context: { params: Promise<{ storeId: string }> }) {
  const auth = await requireAdminScope(["kb:update"]);
  if (!auth.ok) return auth.response;
  try {
    const { storeId } = await context.params;
    const body = await readAdminJson(request);
    assertAdminKeys(body, ["decision"]);
    if (body.decision !== "approve" && body.decision !== "discard") {
      return NextResponse.json({ code: "40000", message: "请选择通过审核或丢弃" }, { status: 400 });
    }
    const store = await setDreamReviewDecision(requiredTenantId(), storeId, body.decision, auth.session.userId);
    return NextResponse.json({ code: "00000", message: "ok", data: { memory_store: toMemoryStoreRecord(store) } });
  } catch (error) {
    if (error instanceof Error && error.name === "MaMemoryValidationError" && error.message === "memory store is not awaiting review") {
      return NextResponse.json({ code: "40900", message: "该记忆库不在待审核状态" }, { status: 409 });
    }
    return memoryErrorResponse(error);
  }
}
