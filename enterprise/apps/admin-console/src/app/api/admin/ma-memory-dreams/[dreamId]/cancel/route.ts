import { NextResponse } from "next/server";

import { requireAdminScope } from "../../../../../../lib/admin-auth";
import { MaRuntimeRequestError, MaRuntimeUnavailableError, runtimeInternal } from "../../../../../../lib/ma/runtime-internal-client";
import { memoryErrorResponse, requiredTenantId } from "../../../ma-memory-stores/shared";

export const dynamic = "force-dynamic";

const RUNTIME_UNAVAILABLE = "记忆整理服务不可达，请确认 agent-runtime 已启动并开启该功能";

export async function POST(_request: Request, context: { params: Promise<{ dreamId: string }> }) {
  const auth = await requireAdminScope(["kb:update"]);
  if (!auth.ok) return auth.response;
  try {
    const { dreamId } = await context.params;
    const result = await runtimeInternal("POST", `/internal/ma/memory-dreams/${dreamId}/cancel`, {
      tenant_id: requiredTenantId(),
    });
    return NextResponse.json({ code: "00000", message: "ok", data: result });
  } catch (error) {
    if (error instanceof MaRuntimeUnavailableError || (error instanceof Error && error.name === "MaRuntimeUnavailableError")) {
      return NextResponse.json({ code: "50300", message: RUNTIME_UNAVAILABLE }, { status: 503 });
    }
    if (error instanceof MaRuntimeRequestError || (error instanceof Error && error.name === "MaRuntimeRequestError")) {
      const status = error instanceof MaRuntimeRequestError ? error.status : 502;
      return NextResponse.json({ code: `${status}00`, message: error.message }, { status });
    }
    return memoryErrorResponse(error);
  }
}
