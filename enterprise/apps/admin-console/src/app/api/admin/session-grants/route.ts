import { NextResponse } from "next/server";
import {
  createSessionGrant,
  listSessionGrants,
  revokeSessionGrant,
} from "@agenticx/iam-core";
import { requireAdminScope } from "../../../../lib/admin-auth";

export async function GET() {
  const guard = await requireAdminScope(["provider:read"]);
  if (!guard.ok) return guard.response;
  return NextResponse.json({
    code: "00000",
    message: "ok",
    data: { grants: await listSessionGrants() },
  });
}

export async function POST(request: Request) {
  const guard = await requireAdminScope(["provider:update"]);
  if (!guard.ok) return guard.response;
  const tenantId = process.env.DEFAULT_TENANT_ID?.trim();
  if (!tenantId) {
    return NextResponse.json({ code: "50000", message: "DEFAULT_TENANT_ID missing" }, { status: 500 });
  }
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ code: "40001", message: "invalid json" }, { status: 400 });
  }
  const sessionId = String(body.sessionId ?? "").trim();
  if (!sessionId) {
    return NextResponse.json({ code: "40000", message: "sessionId required" }, { status: 400 });
  }
  const scopes = Array.isArray(body.scopes) ? body.scopes.map(String) : [];
  const ttlSeconds = Number(body.ttlSeconds ?? 600);
  const grant = await createSessionGrant({
    tenantId,
    sessionId,
    scopes,
    ttlSeconds,
    description: typeof body.description === "string" ? body.description : undefined,
  });
  return NextResponse.json({ code: "00000", message: "ok", data: { grant } });
}

export async function DELETE(request: Request) {
  const guard = await requireAdminScope(["provider:update"]);
  if (!guard.ok) return guard.response;
  const url = new URL(request.url);
  const id = url.searchParams.get("id")?.trim();
  if (!id) {
    return NextResponse.json({ code: "40000", message: "id required" }, { status: 400 });
  }
  const grant = await revokeSessionGrant(id);
  if (!grant) {
    return NextResponse.json({ code: "40400", message: "not found" }, { status: 404 });
  }
  return NextResponse.json({ code: "00000", message: "ok", data: { grant } });
}
