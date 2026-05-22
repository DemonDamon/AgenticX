import { NextResponse } from "next/server";
import { createPat, listPats } from "@agenticx/auth";
import { requireAdminScope } from "../../../../../lib/admin-auth";

export async function GET(request: Request) {
  const auth = await requireAdminScope(["provider:read"]);
  if (!auth.ok) return auth.response;
  const tenantId = process.env.DEFAULT_TENANT_ID?.trim();
  if (!tenantId) {
    return NextResponse.json({ code: "50000", message: "DEFAULT_TENANT_ID missing" }, { status: 500 });
  }
  const url = new URL(request.url);
  const userId = url.searchParams.get("userId")?.trim() || undefined;
  const tokens = await listPats({ tenantId, userId });
  return NextResponse.json({ code: "00000", message: "ok", data: { tokens } });
}

export async function POST(request: Request) {
  const auth = await requireAdminScope(["provider:update"]);
  if (!auth.ok) return auth.response;
  const tenantId = process.env.DEFAULT_TENANT_ID?.trim();
  if (!tenantId) {
    return NextResponse.json({ code: "50000", message: "DEFAULT_TENANT_ID missing" }, { status: 500 });
  }
  try {
    const body = (await request.json()) as {
      name?: string;
      userId?: string;
      deptId?: string;
      expireDays?: number;
      scopes?: string[];
    };
    if (!body.name?.trim() || !body.userId?.trim()) {
      return NextResponse.json({ code: "40000", message: "name and userId required" }, { status: 400 });
    }
    const result = await createPat({
      tenantId,
      userId: body.userId.trim(),
      deptId: body.deptId?.trim() || null,
      name: body.name.trim(),
      createdBy: auth.session.userId,
      expireDays: body.expireDays,
      scopes: body.scopes,
    });
    return NextResponse.json({
      code: "00000",
      message: "ok",
      data: { token: result.token, record: result.record },
    });
  } catch (error) {
    return NextResponse.json(
      { code: "40000", message: error instanceof Error ? error.message : "create failed" },
      { status: 400 }
    );
  }
}
