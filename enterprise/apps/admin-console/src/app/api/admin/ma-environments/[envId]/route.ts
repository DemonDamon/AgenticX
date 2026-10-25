import { NextResponse } from "next/server";
import {
  countMaEnvironmentReferences,
  deleteMaEnvironment,
  getMaEnvironment,
  updateMaEnvironment,
} from "@agenticx/iam-core";

import { requireAdminScope } from "../../../../../lib/admin-auth";
import { requiredTenantId } from "../../agents/shared";
import { environmentErrorResponse, readEnvironmentInput } from "../shared";

export const dynamic = "force-dynamic";

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function GET(_request: Request, context: { params: Promise<{ envId: string }> }) {
  const auth = await requireAdminScope(["provider:read"]);
  if (!auth.ok) return auth.response;
  try {
    const { envId } = await context.params;
    const tenantId = requiredTenantId();
    const environment = await getMaEnvironment(tenantId, envId);
    const references = await countMaEnvironmentReferences(tenantId, environment.id);
    return NextResponse.json({ code: "00000", message: "ok", data: { environment, references } });
  } catch (error) {
    return environmentErrorResponse(error);
  }
}

export async function PATCH(request: Request, context: { params: Promise<{ envId: string }> }) {
  const auth = await requireAdminScope(["provider:update"]);
  if (!auth.ok) return auth.response;
  try {
    const { envId } = await context.params;
    const body = await request.json().catch(() => null);
    if (!isJsonObject(body)) {
      return NextResponse.json({ code: "40000", message: "请求体不是合法 JSON" }, { status: 400 });
    }
    const environment = await updateMaEnvironment(requiredTenantId(), envId, readEnvironmentInput(body, "patch"));
    return NextResponse.json({ code: "00000", message: "ok", data: { environment } });
  } catch (error) {
    return environmentErrorResponse(error);
  }
}

export async function DELETE(_request: Request, context: { params: Promise<{ envId: string }> }) {
  const auth = await requireAdminScope(["provider:update"]);
  if (!auth.ok) return auth.response;
  try {
    const { envId } = await context.params;
    await deleteMaEnvironment(requiredTenantId(), envId);
    return NextResponse.json({ code: "00000", message: "ok", data: { id: envId } });
  } catch (error) {
    return environmentErrorResponse(error);
  }
}
