import { NextResponse } from "next/server";
import { applyMemoryWrite, listMemories } from "@agenticx/iam-core";

import { requireAdminScope } from "../../../../../../lib/admin-auth";
import { MaRequestError } from "../../../../../../lib/ma/http";
import { parseMemoryListQuery, publicMemoryListItem, toMemoryRecord } from "../../../../../../lib/ma/memory-records";
import { assertAdminKeys, memoryErrorResponse, readAdminJson, requiredTenantId } from "../../shared";

export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ storeId: string }> }) {
  const auth = await requireAdminScope(["kb:read"]);
  if (!auth.ok) return auth.response;
  try {
    const { storeId } = await context.params;
    const query = parseMemoryListQuery(new URL(request.url));
    const page = await listMemories(requiredTenantId(), storeId, query);
    return NextResponse.json({
      code: "00000",
      message: "ok",
      data: {
        items: page.items.map((item) => publicMemoryListItem(item, query.view)),
        next_cursor: page.nextCursor,
      },
    });
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
    assertAdminKeys(body, ["path", "content"]);
    if (typeof body.path !== "string" || typeof body.content !== "string") {
      throw new MaRequestError("路径和内容不能为空");
    }
    const result = await applyMemoryWrite(
      requiredTenantId(),
      storeId,
      { op: "create", path: body.path, content: body.content },
      { kind: "user", userId: auth.session.userId },
    );
    if (!result.ok) return memoryErrorResponse(writeFailure(result.code, result.message));
    if (!result.memory) return memoryErrorResponse(writeFailure("memory_not_found", "记忆不存在"));
    return NextResponse.json({ code: "00000", message: "ok", data: { memory: toMemoryRecord(result.memory, true) } });
  } catch (error) {
    return memoryErrorResponse(error);
  }
}

function writeFailure(code: string, message: string): Error {
  const error = new Error(message);
  switch (code) {
    case "memory_version_conflict":
      error.name = "MaMemoryVersionConflictError";
      break;
    case "memory_path_conflict":
      error.name = "MaMemoryPathConflictError";
      break;
    case "memory_not_found":
      error.name = "MaMemoryNotFoundError";
      break;
    case "memory_store_limit":
      error.name = "MaMemoryStoreLimitError";
      break;
    case "invalid_request":
      error.name = "MaMemoryValidationError";
      break;
    default:
      error.name = "Error";
      break;
  }
  return error;
}
