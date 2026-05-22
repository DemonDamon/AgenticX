import { NextResponse } from "next/server";
import { createPat, listPats, revokePat } from "@agenticx/auth";
import { getSessionFromCookies } from "../../../../lib/session";

export async function GET() {
  const session = await getSessionFromCookies();
  if (!session?.userId || !session.tenantId) {
    return NextResponse.json({ code: "40100", message: "unauthorized" }, { status: 401 });
  }
  const tokens = await listPats({ tenantId: session.tenantId, userId: session.userId });
  return NextResponse.json({ code: "00000", message: "ok", data: { tokens } });
}

export async function POST(request: Request) {
  const session = await getSessionFromCookies();
  if (!session?.userId || !session.tenantId) {
    return NextResponse.json({ code: "40100", message: "unauthorized" }, { status: 401 });
  }
  try {
    const body = (await request.json()) as { name?: string; expireDays?: number };
    if (!body.name?.trim()) {
      return NextResponse.json({ code: "40000", message: "name required" }, { status: 400 });
    }
    const result = await createPat({
      tenantId: session.tenantId,
      userId: session.userId,
      deptId: session.deptId ?? null,
      name: body.name.trim(),
      createdBy: session.userId,
      expireDays: body.expireDays,
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

export async function DELETE(request: Request) {
  const session = await getSessionFromCookies();
  if (!session?.userId || !session.tenantId) {
    return NextResponse.json({ code: "40100", message: "unauthorized" }, { status: 401 });
  }
  const url = new URL(request.url);
  const id = Number(url.searchParams.get("id"));
  if (!Number.isFinite(id)) {
    return NextResponse.json({ code: "40000", message: "id required" }, { status: 400 });
  }
  const tokens = await listPats({ tenantId: session.tenantId, userId: session.userId });
  if (!tokens.some((t) => t.id === id)) {
    return NextResponse.json({ code: "40300", message: "forbidden" }, { status: 403 });
  }
  const record = await revokePat(id, session.tenantId);
  return NextResponse.json({ code: "00000", message: "ok", data: { record } });
}
