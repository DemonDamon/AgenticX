import { NextResponse } from "next/server";
import { getMaSession, insertAuditEvent, resolveVaultBundle } from "@agenticx/iam-core";

import { maError, maErrorFromException } from "../../../../../lib/ma/errors";
import { assertOnlyKeys, MaRequestError, readJsonObject, TENANT_ID_RE, ULID_RE } from "../../../../../lib/ma/http";
import { isMaInternalAuthorized, maInternalUnauthorized } from "../../../../../lib/ma/internal-auth";
import { noStore, readStringList } from "../../../../../lib/ma/vault-input";

export const dynamic = "force-dynamic";

function readResolveVaultIds(value: unknown): string[] {
  const ids = readStringList(value, "vault_ids", 20);
  if (ids.some((id) => !ULID_RE.test(id))) throw new MaRequestError("vault_ids must be ULIDs");
  if (new Set(ids).size !== ids.length) throw new MaRequestError("vault_ids must not contain duplicates");
  return ids;
}

export async function POST(request: Request) {
  if (!isMaInternalAuthorized(request)) return noStore(maInternalUnauthorized());
  if (process.env.MA_VAULT_RESOLVE_ENABLED === "0") {
    return noStore(maError("vault_crypto_unavailable", "credential resolution is disabled"));
  }
  try {
    const body = await readJsonObject(request);
    assertOnlyKeys(body, ["tenant_id", "session_id", "vault_ids"]);
    const tenantId = typeof body.tenant_id === "string" ? body.tenant_id : "";
    if (!TENANT_ID_RE.test(tenantId)) return noStore(maError("invalid_request", "tenant_id is required"));
    const sessionId = typeof body.session_id === "string" ? body.session_id : "";
    if (!ULID_RE.test(sessionId)) return noStore(maError("invalid_request", "session_id must be a ULID"));
    const vaultIds = readResolveVaultIds(body.vault_ids);
    const session = await getMaSession(tenantId, sessionId);
    if (!session) return noStore(maError("session_not_found", "session not found"));
    if (session.status === "archived" || session.status === "terminated" || session.archivedAt) {
      return noStore(maError("session_terminated", "session is terminated"));
    }
    if (vaultIds.some((id) => !session.vaultIds.includes(id))) {
      return noStore(maError("invalid_request", "vault_ids must be a subset of the session vault_ids"));
    }
    const bundle = await resolveVaultBundle({
      tenantId,
      sessionId,
      sessionUserId: session.createdByUserId,
      vaultIds,
    });
    try {
      await insertAuditEvent({
        tenantId,
        actorUserId: null,
        eventType: "ma.vault.resolve",
        targetKind: "ma_session",
        targetId: sessionId,
        detail: bundle.auditDetail,
      });
    } catch {
      console.error("ma.vault.resolve_audit_failed", { sessionId });
      return noStore(maError("internal_error", "internal error"));
    }
    return noStore(
      NextResponse.json({
        session_id: bundle.session_id,
        resolved_at: bundle.resolved_at,
        credentials: bundle.credentials,
        skipped: bundle.skipped,
      }),
    );
  } catch (error) {
    return noStore(maErrorFromException(error));
  }
}
