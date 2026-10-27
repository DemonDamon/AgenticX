import { NextResponse } from "next/server";
import { applyMemoryWrite, getMemory } from "@agenticx/iam-core";

import { requireAdminScope } from "../../../../../../../lib/admin-auth";
import { MaRequestError } from "../../../../../../../lib/ma/http";
import { parsePositiveIntParam, toMemoryRecord } from "../../../../../../../lib/ma/memory-records";
import { assertAdminKeys, memoryErrorResponse, readAdminJson, requiredTenantId } from "../../../shared";

export const dynamic = "force-dynamic";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
    case "memory_store_not_found":
      error.name = code === "memory_store_not_found" ? "MaMemoryStoreNotFoundError" : "MaMemoryNotFoundError";
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

export async function GET(_request: Request, context: { params: Promise<{ storeId: string; memoryId: string }> }) {
  const auth = await requireAdminScope(["kb:read"]);
  if (!auth.ok) return auth.response;
  try {
    const { storeId, memoryId } = await context.params;
    const memory = await getMemory(requiredTenantId(), storeId, memoryId);
    return NextResponse.json({ code: "00000", message: "ok", data: { memory: toMemoryRecord(memory, true) } });
  } catch (error) {
    return memoryErrorResponse(error);
  }
}

export async function PATCH(request: Request, context: { params: Promise<{ storeId: string; memoryId: string }> }) {
  const auth = await requireAdminScope(["kb:update"]);
  if (!auth.ok) return auth.response;
  try {
    const { storeId, memoryId } = await context.params;
    const body = await readAdminJson(request);
    assertAdminKeys(body, ["path", "content", "expected_version", "precondition"]);
    const hasVersion = "expected_version" in body;
    const hasPrecondition = "precondition" in body;
    if (!hasVersion && !hasPrecondition) throw new MaRequestError("expected_version or precondition is required");
    let expectedVersion: number | undefined;
    if (hasVersion) {
      if (typeof body.expected_version !== "number" || !Number.isInteger(body.expected_version) || body.expected_version < 1) {
        throw new MaRequestError("expected_version: must be a positive integer");
      }
      expectedVersion = body.expected_version;
    }
    if (hasPrecondition) {
      const precondition = body.precondition;
      if (!isRecord(precondition) || precondition.type !== "content_sha256" || typeof precondition.content_sha256 !== "string") {
        throw new MaRequestError("precondition 不合法");
      }
      const current = await getMemory(requiredTenantId(), storeId, memoryId);
      if (current.contentSha256 !== precondition.content_sha256) {
        return memoryErrorResponse(writeFailure("memory_version_conflict", "conflict"));
      }
      if (expectedVersion === undefined) expectedVersion = current.version;
    }
    if (expectedVersion === undefined) throw new MaRequestError("expected_version or precondition is required");
    const result = await applyMemoryWrite(
      requiredTenantId(),
      storeId,
      {
        op: "update",
        memoryId,
        expectedVersion,
        ...(typeof body.path === "string" ? { path: body.path } : {}),
        ...(typeof body.content === "string" ? { content: body.content } : {}),
      },
      { kind: "user", userId: auth.session.userId },
    );
    if (!result.ok) return memoryErrorResponse(writeFailure(result.code, result.message));
    if (!result.memory) return memoryErrorResponse(writeFailure("memory_not_found", "记忆不存在"));
    return NextResponse.json({ code: "00000", message: "ok", data: { memory: toMemoryRecord(result.memory, true) } });
  } catch (error) {
    return memoryErrorResponse(error);
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ storeId: string; memoryId: string }> }) {
  const auth = await requireAdminScope(["kb:delete"]);
  if (!auth.ok) return auth.response;
  try {
    const { storeId, memoryId } = await context.params;
    const url = new URL(request.url);
    let expectedVersion = parsePositiveIntParam(url.searchParams.get("expected_version"), "expected_version");
    const expectedSha = url.searchParams.get("expected_content_sha256");
    if (expectedVersion == null && !expectedSha) throw new MaRequestError("expected_version or precondition is required");
    if (expectedSha) {
      const current = await getMemory(requiredTenantId(), storeId, memoryId);
      if (current.contentSha256 !== expectedSha || (expectedVersion != null && expectedVersion !== current.version)) {
        return memoryErrorResponse(writeFailure("memory_version_conflict", "conflict"));
      }
      expectedVersion = current.version;
    }
    if (expectedVersion == null) throw new MaRequestError("expected_version or precondition is required");
    const result = await applyMemoryWrite(
      requiredTenantId(),
      storeId,
      { op: "delete", memoryId, expectedVersion },
      { kind: "user", userId: auth.session.userId },
    );
    if (!result.ok) return memoryErrorResponse(writeFailure(result.code, result.message));
    return NextResponse.json({ code: "00000", message: "ok", data: { id: memoryId, deleted: true, version: result.version } });
  } catch (error) {
    return memoryErrorResponse(error);
  }
}
