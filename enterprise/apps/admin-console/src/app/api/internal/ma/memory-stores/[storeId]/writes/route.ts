import { NextResponse } from "next/server";
import { applyMemoryWrite } from "@agenticx/iam-core";

import { maError, maErrorFromException } from "../../../../../../../lib/ma/errors";
import { assertOnlyKeys, readJsonObject, TENANT_ID_RE } from "../../../../../../../lib/ma/http";
import { isMaInternalAuthorized, maInternalUnauthorized } from "../../../../../../../lib/ma/internal-auth";
import {
  currentDetails,
  memoryInternalDisabledResponse,
  parseMemoryWriteOps,
  requireMountedMemorySession,
} from "../../../../../../../lib/ma/memory-records";
import { noStore } from "../../../../../../../lib/ma/vault-input";

export const dynamic = "force-dynamic";

export async function POST(request: Request, context: { params: Promise<{ storeId: string }> }) {
  if (!isMaInternalAuthorized(request)) return noStore(maInternalUnauthorized());
  const disabled = memoryInternalDisabledResponse();
  if (disabled) return disabled;
  try {
    const { storeId } = await context.params;
    const body = await readJsonObject(request);
    assertOnlyKeys(body, ["tenant_id", "session_id", "ops"]);
    const tenantId = typeof body.tenant_id === "string" ? body.tenant_id : "";
    const sessionId = typeof body.session_id === "string" ? body.session_id : "";
    if (!TENANT_ID_RE.test(tenantId)) return noStore(maError("invalid_request", "tenant_id is required"));
    if (!sessionId) return noStore(maError("invalid_request", "session_id is required"));
    const ops = parseMemoryWriteOps(body.ops);
    const mounted = await requireMountedMemorySession(tenantId, sessionId, storeId, "write");
    if (!mounted.ok) return mounted.response;
    const results = [];
    for (let index = 0; index < ops.length; index += 1) {
      const parsed = ops[index];
      if (!parsed || !parsed.ok) {
        results.push({
          index,
          ok: false,
          code: "invalid_request",
          message: parsed?.message ?? "op must be an object",
          current: null,
        });
        continue;
      }
      const result = await applyMemoryWrite(tenantId, storeId, parsed.op, {
        kind: "agent",
        userId: mounted.createdByUserId,
        sessionId,
      });
      if (!result.ok) {
        results.push({
          index,
          ok: false,
          code: result.code,
          message: result.message,
          current: currentDetails(result.current),
        });
        continue;
      }
      results.push({
        index,
        ok: true,
        memory: result.memory
          ? {
              id: result.memory.id,
              path: result.memory.path,
              version: result.memory.version,
              content_sha256: result.memory.contentSha256,
            }
          : null,
        ...(result.memory == null ? { deleted_version: result.version } : {}),
      });
    }
    return noStore(NextResponse.json({ results }));
  } catch (error) {
    return noStore(maErrorFromException(error));
  }
}
