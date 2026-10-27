import { NextResponse } from "next/server";
import { countMaEnvironmentReferences, createMaEnvironment, listMaEnvironments } from "@agenticx/iam-core";

import { requireAdminScope } from "../../../../lib/admin-auth";
import { emitMaResourceEvent } from "../../../../lib/ma/webhook-events";
import { requiredTenantId } from "../agents/shared";
import { environmentErrorResponse, readEnvironmentInput, readEnvironmentListFilter } from "./shared";

export const dynamic = "force-dynamic";

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function GET(request: Request) {
  const auth = await requireAdminScope(["provider:read"]);
  if (!auth.ok) return auth.response;
  try {
    const tenantId = requiredTenantId();
    const environments = await listMaEnvironments(tenantId, readEnvironmentListFilter(new URL(request.url)));
    const withReferences = await Promise.all(
      environments.map(async (environment) => ({
        ...environment,
        references: await countMaEnvironmentReferences(tenantId, environment.id),
      })),
    );
    return NextResponse.json({ code: "00000", message: "ok", data: { environments: withReferences } });
  } catch (error) {
    return environmentErrorResponse(error);
  }
}

export async function POST(request: Request) {
  const auth = await requireAdminScope(["provider:update"]);
  if (!auth.ok) return auth.response;
  try {
    const body = await request.json().catch(() => null);
    if (!isJsonObject(body)) {
      return NextResponse.json({ code: "40000", message: "请求体不是合法 JSON" }, { status: 400 });
    }
    const environment = await createMaEnvironment(
      requiredTenantId(),
      readEnvironmentInput(body, "create"),
      auth.session.userId,
    );
    emitMaResourceEvent({ tenantId: requiredTenantId(), type: "environment.created", resourceId: environment.id });
    return NextResponse.json({ code: "00000", message: "ok", data: { environment } });
  } catch (error) {
    return environmentErrorResponse(error);
  }
}
