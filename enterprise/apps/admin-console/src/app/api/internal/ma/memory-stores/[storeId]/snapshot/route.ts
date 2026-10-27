import { NextResponse } from "next/server";
import { snapshotMemoryStore } from "@agenticx/iam-core";

import { maError, maErrorFromException } from "../../../../../../../lib/ma/errors";
import { TENANT_ID_RE } from "../../../../../../../lib/ma/http";
import { isMaInternalAuthorized, maInternalUnauthorized } from "../../../../../../../lib/ma/internal-auth";
import { memoryInternalDisabledResponse, requireMountedMemorySession } from "../../../../../../../lib/ma/memory-records";
import { noStore } from "../../../../../../../lib/ma/vault-input";

export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ storeId: string }> }) {
  if (!isMaInternalAuthorized(request)) return noStore(maInternalUnauthorized());
  const disabled = memoryInternalDisabledResponse();
  if (disabled) return disabled;
  try {
    const { storeId } = await context.params;
    const url = new URL(request.url);
    const tenantId = url.searchParams.get("tenant_id") ?? "";
    const sessionId = url.searchParams.get("session_id") ?? "";
    if (!TENANT_ID_RE.test(tenantId)) return noStore(maError("invalid_request", "tenant_id is required"));
    if (!sessionId) return noStore(maError("invalid_request", "session_id is required"));
    const mounted = await requireMountedMemorySession(tenantId, sessionId, storeId, "read");
    if (!mounted.ok) return mounted.response;
    const snapshot = await snapshotMemoryStore(tenantId, storeId);
    return noStore(
      NextResponse.json({
        memory_store: { id: snapshot.store.id, name: snapshot.store.name, status: snapshot.store.status },
        memories: snapshot.memories.map((memory) => ({
          id: memory.id,
          path: memory.path,
          content: memory.content ?? "",
          content_sha256: memory.contentSha256,
          size_bytes: memory.sizeBytes,
          version: memory.version,
        })),
      }),
    );
  } catch (error) {
    return noStore(maErrorFromException(error));
  }
}
