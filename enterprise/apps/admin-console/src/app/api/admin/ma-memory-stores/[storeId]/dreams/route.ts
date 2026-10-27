import { NextResponse } from "next/server";
import { listMemoryDreams } from "@agenticx/iam-core";

import { requireAdminScope } from "../../../../../../lib/admin-auth";
import { MaRuntimeRequestError, MaRuntimeUnavailableError, runtimeInternal } from "../../../../../../lib/ma/runtime-internal-client";
import { assertAdminKeys, memoryErrorResponse, readAdminJson, requiredTenantId } from "../../shared";

export const dynamic = "force-dynamic";

const RUNTIME_UNAVAILABLE = "记忆整理服务不可达，请确认 agent-runtime 已启动并开启该功能";

function runtimeFailure(error: unknown): NextResponse | null {
  if (error instanceof MaRuntimeUnavailableError || (error instanceof Error && error.name === "MaRuntimeUnavailableError")) {
    return NextResponse.json({ code: "50300", message: RUNTIME_UNAVAILABLE }, { status: 503 });
  }
  if (error instanceof MaRuntimeRequestError || (error instanceof Error && error.name === "MaRuntimeRequestError")) {
    const status = error instanceof MaRuntimeRequestError ? error.status : 502;
    return NextResponse.json({ code: `${status}00`, message: error.message }, { status });
  }
  return null;
}

export async function GET(_request: Request, context: { params: Promise<{ storeId: string }> }) {
  const auth = await requireAdminScope(["kb:read"]);
  if (!auth.ok) return auth.response;
  try {
    const { storeId } = await context.params;
    const dreams = await listMemoryDreams(requiredTenantId(), { inputStoreId: storeId, limit: 100 });
    return NextResponse.json({ code: "00000", message: "ok", data: { dreams } });
  } catch (error) {
    return memoryErrorResponse(error);
  }
}

export async function POST(request: Request, context: { params: Promise<{ storeId: string }> }) {
  const auth = await requireAdminScope(["kb:update"]);
  if (!auth.ok) return auth.response;
  try {
    const { storeId } = await context.params;
    const body = await readAdminJson(request);
    assertAdminKeys(body, ["session_ids", "instructions", "model", "output_memory_store_name", "output_memory_store_description"]);
    const result = await runtimeInternal("POST", "/internal/ma/memory-dreams", {
      tenant_id: requiredTenantId(),
      created_by_user_id: auth.session.userId,
      input_memory_store_id: storeId,
      session_ids: body.session_ids,
      instructions: body.instructions,
      model: body.model,
      output_memory_store_name: body.output_memory_store_name,
      ...(body.output_memory_store_description === undefined
        ? {}
        : { output_memory_store_description: body.output_memory_store_description }),
    });
    return NextResponse.json({ code: "00000", message: "ok", data: result });
  } catch (error) {
    return runtimeFailure(error) ?? memoryErrorResponse(error);
  }
}
