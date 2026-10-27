import { NextResponse } from "next/server";
import { finishDreamOutputStore } from "@agenticx/iam-core";

import { maError, maErrorFromException } from "../../../../../../../lib/ma/errors";
import { assertOnlyKeys, MaRequestError, readJsonObject, TENANT_ID_RE, ULID_RE } from "../../../../../../../lib/ma/http";
import { isMaInternalAuthorized, maInternalUnauthorized } from "../../../../../../../lib/ma/internal-auth";
import { memoryInternalDisabledResponse, toMemoryStoreRecord } from "../../../../../../../lib/ma/memory-records";
import { noStore } from "../../../../../../../lib/ma/vault-input";

export const dynamic = "force-dynamic";

const OUTCOMES = ["completed", "failed", "cancelled"] as const;
type DreamOutcome = (typeof OUTCOMES)[number];

function isOutcome(value: unknown): value is DreamOutcome {
  return typeof value === "string" && (OUTCOMES as readonly string[]).includes(value);
}

function readMemories(value: unknown): { path: string; content: string }[] {
  if (!Array.isArray(value) || value.length > 300) {
    throw new MaRequestError("memories: must contain at most 300 items");
  }
  return value.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new MaRequestError("memories: each item needs path and content");
    }
    const record = item as Record<string, unknown>;
    if (typeof record.path !== "string" || typeof record.content !== "string") {
      throw new MaRequestError("memories: each item needs path and content");
    }
    return { path: record.path, content: record.content };
  });
}

export async function POST(request: Request, context: { params: Promise<{ storeId: string }> }) {
  if (!isMaInternalAuthorized(request)) return noStore(maInternalUnauthorized());
  const disabled = memoryInternalDisabledResponse();
  if (disabled) return disabled;
  try {
    const { storeId } = await context.params;
    const body = await readJsonObject(request);
    assertOnlyKeys(body, ["tenant_id", "dream_id", "outcome", "memories", "actor_user_id"]);
    const tenantId = typeof body.tenant_id === "string" ? body.tenant_id : "";
    if (!TENANT_ID_RE.test(tenantId)) throw new MaRequestError("tenant_id is required");
    const dreamId = typeof body.dream_id === "string" ? body.dream_id : "";
    if (!ULID_RE.test(dreamId)) throw new MaRequestError("dream_id: must be a ULID");
    if (!isOutcome(body.outcome)) throw new MaRequestError("outcome: must be completed, failed, or cancelled");
    const memories = readMemories(body.memories ?? []);
    const actorUserId = typeof body.actor_user_id === "string" ? body.actor_user_id : null;
    try {
      const store = await finishDreamOutputStore(tenantId, storeId, {
        dreamId,
        outcome: body.outcome,
        memories,
        actorUserId,
      });
      return noStore(NextResponse.json({ memory_store: toMemoryStoreRecord(store) }));
    } catch (error) {
      if (error instanceof Error && error.name === "MaMemoryValidationError" && error.message.startsWith("dream import failed")) {
        try {
          await finishDreamOutputStore(tenantId, storeId, {
            dreamId,
            outcome: "failed",
            memories: [],
            actorUserId,
          });
        } catch (archiveError) {
          console.error("dream import archive failed", archiveError instanceof Error ? archiveError.name : "error");
        }
        return noStore(maError("invalid_request", error.message));
      }
      throw error;
    }
  } catch (error) {
    return noStore(maErrorFromException(error));
  }
}
