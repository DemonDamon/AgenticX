import { NextResponse } from "next/server";
import { assertActorMayManagePatUser, createPat, isAllowedPatScope, listPats } from "@agenticx/iam-core";
import { requireAdminScope } from "../../../../lib/admin-auth";

export async function GET(request: Request) {
  try {
    const auth = await requireAdminScope(["user:read"]);
    if (!auth.ok) return auth.response;
    const tenantId = auth.session.tenantId;
    if (!tenantId) {
      return NextResponse.json({ code: "50000", message: "DEFAULT_TENANT_ID missing" }, { status: 500 });
    }
    const url = new URL(request.url);
    const userId = url.searchParams.get("userId")?.trim() || undefined;
    const actor = { kind: "user" as const, tenantId, userId: auth.session.userId, scopes: auth.scopes };
    if (userId) await assertActorMayManagePatUser(tenantId, userId, actor);
    const records = await listPats({ tenantId, userId });
    const visible = new Map<string, boolean>();
    for (const record of records) {
      if (visible.has(record.userId)) continue;
      try { await assertActorMayManagePatUser(tenantId, record.userId, actor); visible.set(record.userId, true); }
      catch (error) {
        if (!(error instanceof Error) || error.name !== "PrivilegeEscalationError") throw error;
        visible.set(record.userId, false);
      }
    }
    const tokens = records.filter((record) => visible.get(record.userId));
    return NextResponse.json({ code: "00000", message: "ok", data: { tokens } });
  } catch (error) {
    if (error instanceof Error && error.name === "PrivilegeEscalationError") return NextResponse.json({ code: "40300", message: "forbidden" }, { status: 403 });
    const message = error instanceof Error ? error.message : "failed to load api tokens";
    const hint = /api_tokens|relation .* does not exist/i.test(message)
      ? "请先执行 pnpm --filter @agenticx/db-schema db:migrate"
      : message;
    return NextResponse.json({ code: "50000", message: hint }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const auth = await requireAdminScope(["user:update"]);
  if (!auth.ok) return auth.response;
  const tenantId = auth.session.tenantId;
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
    if (body.scopes !== undefined) {
      if (!Array.isArray(body.scopes) || body.scopes.some((scope) => typeof scope !== "string" || !scope.trim())) {
        return NextResponse.json({ code: "40000", message: "权限列表不合法" }, { status: 400 });
      }
      const unknown = body.scopes
        .map((scope) => scope.trim())
        .find((scope) => !isAllowedPatScope(scope));
      if (unknown) {
        return NextResponse.json({ code: "40000", message: "不支持的令牌权限" }, { status: 400 });
      }
    }
    const result = await createPat({
      tenantId,
      actor: { kind: "user", tenantId, userId: auth.session.userId, scopes: auth.scopes },
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
    const forbidden = error instanceof Error && error.name === "PrivilegeEscalationError";
    return NextResponse.json(
      { code: forbidden ? "40300" : "40000", message: error instanceof Error ? error.message : "create failed" },
      { status: forbidden ? 403 : 400 }
    );
  }
}
