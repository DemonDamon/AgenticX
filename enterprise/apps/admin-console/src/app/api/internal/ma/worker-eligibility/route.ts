import { NextResponse } from "next/server";
import { getAdminUser, listMaEnvironments, resolveAssignmentKeysForUser } from "@agenticx/iam-core";

import { maError, maErrorFromException } from "../../../../../lib/ma/errors";
import { TENANT_ID_RE, ULID_RE } from "../../../../../lib/ma/http";
import { isMaInternalAuthorized, maInternalUnauthorized } from "../../../../../lib/ma/internal-auth";
import { toMaEnvironmentRecord } from "../../../../../lib/ma/records";

export const dynamic = "force-dynamic";

function noStore(response: NextResponse): NextResponse {
  response.headers.set("cache-control", "no-store");
  return response;
}

export async function GET(request: Request) {
  if (!isMaInternalAuthorized(request)) return noStore(maInternalUnauthorized());
  try {
    const url = new URL(request.url);
    const tenantId = (url.searchParams.get("tenant_id") ?? "").trim();
    const userId = (url.searchParams.get("user_id") ?? "").trim();
    if (!TENANT_ID_RE.test(tenantId)) return noStore(maError("invalid_request", "tenant_id is required"));
    if (!ULID_RE.test(userId)) return noStore(maError("invalid_request", "user_id is required"));
    const user = await getAdminUser(tenantId, userId);
    if (!user || user.status === "disabled") {
      return noStore(NextResponse.json({ user_id: userId, assignment_keys: [], environments: [] }));
    }
    const keys = await resolveAssignmentKeysForUser(tenantId, user.id, user.email, user.deptId ?? null);
    const wanted = new Set(keys.map((k) => k.trim()).filter(Boolean));
    const envs = await listMaEnvironments(tenantId, { type: "desktop_worker", status: "active" });
    const eligible = envs.filter((env) => {
      const workerKeys = env.config.type === "desktop_worker" ? env.config.worker_keys : [];
      return workerKeys.some((k) => wanted.has(String(k).trim()));
    });
    return noStore(
      NextResponse.json({
        user_id: userId,
        assignment_keys: [...wanted],
        environments: eligible.map(toMaEnvironmentRecord),
      }),
    );
  } catch (error) {
    return noStore(maErrorFromException(error));
  }
}
