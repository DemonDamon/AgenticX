import { NextResponse } from "next/server";
import { createDreamOutputStore, dreamOutputMetadata } from "@agenticx/iam-core";

import { maErrorFromException } from "../../../../../../lib/ma/errors";
import { assertOnlyKeys, MaRequestError, readJsonObject, TENANT_ID_RE, ULID_RE } from "../../../../../../lib/ma/http";
import { isMaInternalAuthorized, maInternalUnauthorized } from "../../../../../../lib/ma/internal-auth";
import { memoryInternalDisabledResponse, toMemoryStoreRecord } from "../../../../../../lib/ma/memory-records";
import { noStore } from "../../../../../../lib/ma/vault-input";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!isMaInternalAuthorized(request)) return noStore(maInternalUnauthorized());
  const disabled = memoryInternalDisabledResponse();
  if (disabled) return disabled;
  try {
    const body = await readJsonObject(request);
    assertOnlyKeys(body, ["tenant_id", "input_memory_store_id", "name", "description", "dream_id", "created_by_user_id"]);
    const tenantId = typeof body.tenant_id === "string" ? body.tenant_id : "";
    if (!TENANT_ID_RE.test(tenantId)) throw new MaRequestError("tenant_id is required");
    const inputStoreId = typeof body.input_memory_store_id === "string" ? body.input_memory_store_id : "";
    if (!ULID_RE.test(inputStoreId)) throw new MaRequestError("input_memory_store_id: must be a ULID");
    const dreamId = typeof body.dream_id === "string" ? body.dream_id : "";
    if (!ULID_RE.test(dreamId)) throw new MaRequestError("dream_id: must be a ULID");
    const name = typeof body.name === "string" ? body.name : "";
    if (name.length < 1 || name.length > 255) throw new MaRequestError("name: must be 1-255 characters");
    let description: string | null = null;
    if ("description" in body && body.description != null) {
      if (typeof body.description !== "string" || body.description.length > 1024) {
        throw new MaRequestError("description: must be at most 1024 characters");
      }
      description = body.description;
    }
    const createdBy = typeof body.created_by_user_id === "string" ? body.created_by_user_id : null;
    const store = await createDreamOutputStore(tenantId, {
      inputStoreId,
      name,
      description,
      dreamId,
      createdBy,
      metadata: dreamOutputMetadata(dreamId, inputStoreId),
    });
    return noStore(NextResponse.json({ memory_store: toMemoryStoreRecord(store) }, { status: 201 }));
  } catch (error) {
    return noStore(maErrorFromException(error));
  }
}
