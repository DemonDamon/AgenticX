import { NextResponse } from "next/server";
import { channelCredentialAudit, insertAuditEvent, openSecretPayload, readMaChannelAppSecret } from "@agenticx/iam-core";

import { maError, maErrorFromException } from "../../../../../../../lib/ma/errors";
import { assertOnlyKeys, readJsonObject, TENANT_ID_RE, ULID_RE } from "../../../../../../../lib/ma/http";
import { isMaInternalAuthorized, maInternalUnauthorized } from "../../../../../../../lib/ma/internal-auth";

export const dynamic = "force-dynamic";

function noStore(response: NextResponse): NextResponse {
  response.headers.set("cache-control", "no-store");
  return response;
}

export async function POST(request: Request, context: { params: Promise<{ channelId: string }> }) {
  if (!isMaInternalAuthorized(request)) return noStore(maInternalUnauthorized());
  try {
    const { channelId } = await context.params;
    if (!ULID_RE.test(channelId)) return noStore(maError("channel_not_found", "channel not found"));
    const body = await readJsonObject(request);
    assertOnlyKeys(body, ["tenant_id"]);
    const tenantId = typeof body.tenant_id === "string" ? body.tenant_id : "";
    if (!TENANT_ID_RE.test(tenantId)) return noStore(maError("invalid_request", "tenant_id is required"));
    const loaded = await readMaChannelAppSecret(tenantId, channelId);
    try {
      await insertAuditEvent(channelCredentialAudit(tenantId, channelId, loaded.vaultId, loaded.credentialId));
    } catch {
      console.error("ma.channel.credential_resolve_audit_failed", { channelId });
      return noStore(maError("internal_error", "internal error"));
    }
    const appSecret = openSecretPayload(loaded.sealed).secret_value;
    if (!appSecret) return noStore(maError("channel_credential_unavailable", "channel credential is unavailable"));
    return noStore(NextResponse.json({ app_id: loaded.appId, app_secret: appSecret }));
  } catch (error) {
    return noStore(maErrorFromException(error));
  }
}
