import { NextResponse } from "next/server";
import { listExpiringMaCredentials } from "@agenticx/iam-core";

import { maError, maErrorFromException } from "../../../../../../lib/ma/errors";
import { MaRequestError } from "../../../../../../lib/ma/http";
import { isMaInternalAuthorized, maInternalUnauthorized } from "../../../../../../lib/ma/internal-auth";

export const dynamic = "force-dynamic";

function noStore(response: NextResponse): NextResponse {
  response.headers.set("cache-control", "no-store");
  return response;
}

function readWithinHours(raw: string | null): number {
  if (raw == null || raw === "") return 72;
  if (!/^\d+$/.test(raw)) throw new MaRequestError("within_hours is invalid");
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > 720) throw new MaRequestError("within_hours is invalid");
  return value;
}

export async function GET(request: Request) {
  if (!isMaInternalAuthorized(request)) return noStore(maInternalUnauthorized());
  try {
    const withinHours = readWithinHours(new URL(request.url).searchParams.get("within_hours"));
    const credentials = await listExpiringMaCredentials(withinHours);
    return noStore(
      NextResponse.json({
        data: credentials.map((item) => ({
          tenant_id: item.tenantId,
          vault_id: item.vaultId,
          credential_id: item.credentialId,
          credential_type: item.credentialType,
          display_name: item.displayName,
          expires_at: item.expiresAt,
        })),
      }),
    );
  } catch (error) {
    if (error instanceof MaRequestError) return noStore(maError("invalid_request", error.message));
    return noStore(maErrorFromException(error));
  }
}
