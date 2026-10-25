import { NextResponse } from "next/server";
import { getMaEnvironment } from "@agenticx/iam-core";

import { maError, maErrorFromException } from "../../../../../../lib/ma/errors";
import { isMaInternalAuthorized, maInternalUnauthorized } from "../../../../../../lib/ma/internal-auth";
import { TENANT_ID_RE, ULID_RE } from "../../../../../../lib/ma/http";
import { toMaEnvironmentRecord } from "../../../../../../lib/ma/records";

export const dynamic = "force-dynamic";

function noStore(response: NextResponse): NextResponse {
  response.headers.set("cache-control", "no-store");
  return response;
}

export async function GET(request: Request, context: { params: Promise<{ envId: string }> }) {
  if (!isMaInternalAuthorized(request)) return noStore(maInternalUnauthorized());
  try {
    const tenantId = new URL(request.url).searchParams.get("tenant_id") ?? "";
    if (!TENANT_ID_RE.test(tenantId)) return noStore(maError("invalid_request", "tenant_id is required"));
    const { envId } = await context.params;
    if (!ULID_RE.test(envId)) return noStore(maError("environment_not_found", "environment not found"));
    const environment = await getMaEnvironment(tenantId, envId);
    return noStore(NextResponse.json({ environment: toMaEnvironmentRecord(environment) }));
  } catch (error) {
    return noStore(maErrorFromException(error));
  }
}
