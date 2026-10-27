import { NextResponse } from "next/server";
import { applyMemoryWrite, getMemory } from "@agenticx/iam-core";

import { maError, maErrorFromException } from "../../../../../../../../lib/ma/errors";
import { assertOnlyKeys, MaRequestError, readJsonObject, ULID_RE } from "../../../../../../../../lib/ma/http";
import { memoryWriteFailureResponse, parsePositiveIntParam, toMemoryRecord } from "../../../../../../../../lib/ma/memory-records";
import { requireMaPat } from "../../../../../../../../lib/ma/pat-auth";
import { noStore } from "../../../../../../../../lib/ma/vault-input";

export const dynamic = "force-dynamic";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function GET(request: Request, context: { params: Promise<{ storeId: string; memoryId: string }> }) {
  const auth = await requireMaPat(request, "ma:memory:read");
  if (!auth.ok) return noStore(auth.response);
  try {
    const { storeId, memoryId } = await context.params;
    if (!ULID_RE.test(memoryId)) return noStore(maError("memory_not_found", "memory not found"));
    const memory = await getMemory(auth.identity.tenantId, storeId, memoryId);
    return noStore(NextResponse.json({ memory: toMemoryRecord(memory, true) }));
  } catch (error) {
    return noStore(maErrorFromException(error));
  }
}

export async function PATCH(request: Request, context: { params: Promise<{ storeId: string; memoryId: string }> }) {
  const auth = await requireMaPat(request, "ma:memory:write");
  if (!auth.ok) return noStore(auth.response);
  try {
    const { storeId, memoryId } = await context.params;
    if (!ULID_RE.test(memoryId)) return noStore(maError("memory_not_found", "memory not found"));
    const body = await readJsonObject(request);
    assertOnlyKeys(body, ["path", "content", "expected_version", "precondition"]);
    const hasVersion = "expected_version" in body;
    const hasPrecondition = "precondition" in body;
    if (!hasVersion && !hasPrecondition) {
      throw new MaRequestError("expected_version or precondition is required");
    }
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
        throw new MaRequestError('precondition: must be {type:"content_sha256", content_sha256}');
      }
      const current = await getMemory(auth.identity.tenantId, storeId, memoryId);
      if (current.contentSha256 !== precondition.content_sha256) {
        return noStore(
          maError("memory_version_conflict", "memory has been modified", {
            current: {
              id: current.id,
              path: current.path,
              version: current.version,
              content_sha256: current.contentSha256,
            },
          }),
        );
      }
      if (expectedVersion === undefined) expectedVersion = current.version;
    }
    if (expectedVersion === undefined) throw new MaRequestError("expected_version or precondition is required");
    if (body.path !== undefined && typeof body.path !== "string") throw new MaRequestError("path: must be a string");
    if (body.content !== undefined && typeof body.content !== "string") throw new MaRequestError("content: must be a string");
    const result = await applyMemoryWrite(
      auth.identity.tenantId,
      storeId,
      {
        op: "update",
        memoryId,
        expectedVersion,
        ...(typeof body.path === "string" ? { path: body.path } : {}),
        ...(typeof body.content === "string" ? { content: body.content } : {}),
      },
      { kind: "user", userId: auth.identity.userId },
    );
    if (!result.ok) return noStore(memoryWriteFailureResponse(result));
    if (!result.memory) return noStore(maError("memory_not_found", "memory not found"));
    return noStore(NextResponse.json({ memory: toMemoryRecord(result.memory, true) }));
  } catch (error) {
    return noStore(maErrorFromException(error));
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ storeId: string; memoryId: string }> }) {
  const auth = await requireMaPat(request, "ma:memory:write");
  if (!auth.ok) return noStore(auth.response);
  try {
    const { storeId, memoryId } = await context.params;
    if (!ULID_RE.test(memoryId)) return noStore(maError("memory_not_found", "memory not found"));
    const url = new URL(request.url);
    let expectedVersion = parsePositiveIntParam(url.searchParams.get("expected_version"), "expected_version");
    const expectedSha = url.searchParams.get("expected_content_sha256");
    if (expectedVersion == null && !expectedSha) {
      throw new MaRequestError("expected_version or precondition is required");
    }
    if (expectedSha) {
      const current = await getMemory(auth.identity.tenantId, storeId, memoryId);
      if (current.contentSha256 !== expectedSha) {
        return noStore(
          maError("memory_version_conflict", "memory has been modified", {
            current: {
              id: current.id,
              path: current.path,
              version: current.version,
              content_sha256: current.contentSha256,
            },
          }),
        );
      }
      if (expectedVersion == null) expectedVersion = current.version;
      if (expectedVersion !== current.version) {
        return noStore(
          maError("memory_version_conflict", "memory has been modified", {
            current: {
              id: current.id,
              path: current.path,
              version: current.version,
              content_sha256: current.contentSha256,
            },
          }),
        );
      }
    }
    if (expectedVersion == null) throw new MaRequestError("expected_version or precondition is required");
    const result = await applyMemoryWrite(
      auth.identity.tenantId,
      storeId,
      { op: "delete", memoryId, expectedVersion },
      { kind: "user", userId: auth.identity.userId },
    );
    if (!result.ok) return noStore(memoryWriteFailureResponse(result));
    return noStore(NextResponse.json({ id: memoryId, deleted: true, version: result.version }));
  } catch (error) {
    return noStore(maErrorFromException(error));
  }
}
