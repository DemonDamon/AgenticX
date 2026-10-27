import { NextResponse } from "next/server";
import { touchPatLastUsed, verifyPat } from "@agenticx/iam-core";

import { maError, maErrorFromException } from "../../../../../lib/ma/errors";
import { readJsonObject } from "../../../../../lib/ma/http";
import { isMaInternalAuthorized, maInternalUnauthorized } from "../../../../../lib/ma/internal-auth";

export const dynamic = "force-dynamic";

function noStore(response: NextResponse): NextResponse {
  response.headers.set("cache-control", "no-store");
  return response;
}

export async function POST(request: Request) {
  if (!isMaInternalAuthorized(request)) return noStore(maInternalUnauthorized());
  try {
    let body: Record<string, unknown>;
    try {
      body = await readJsonObject(request);
    } catch {
      return noStore(maError("invalid_request", "token is required"));
    }
    if (typeof body.token !== "string" || !body.token) {
      return noStore(maError("invalid_request", "token is required"));
    }
    const verified = await verifyPat(body.token);
    if (!verified) return noStore(NextResponse.json({ active: false }));
    void Promise.resolve(touchPatLastUsed(verified.id)).catch(() => {});
    return noStore(
      NextResponse.json({
        active: true,
        tenant_id: verified.tenantId,
        user_id: verified.userId,
        dept_id: verified.deptId,
        scopes: verified.scopes,
        token_id: verified.id,
      }),
    );
  } catch (error) {
    return noStore(maErrorFromException(error));
  }
}
