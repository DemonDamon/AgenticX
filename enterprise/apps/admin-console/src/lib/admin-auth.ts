import { hasEveryScope, hasSomeScope, getAdminUser } from "@agenticx/iam-core";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { ADMIN_SESSION_COOKIE, verifyAdminSessionToken } from "./admin-session";

export type AdminSession = {
  email: string;
  userId: string;
  tenantId: string;
};

export async function getAdminSession(): Promise<AdminSession | null> {
  const store = await cookies();
  const token = store.get(ADMIN_SESSION_COOKIE)?.value;
  const payload = verifyAdminSessionToken(token);
  if (!payload) return null;
  return { email: payload.email, userId: payload.userId, tenantId: payload.tenantId };
}

export async function requireAdminSession() {
  const session = await getAdminSession();
  if (!session) {
    return {
      ok: false as const,
      response: NextResponse.json({ code: "40101", message: "unauthorized" }, { status: 401 }),
    };
  }
  return { ok: true as const, session };
}

/** 当前账号必须仍有效，再以数据库聚合权限校验；缺权或停用返回 403。 */
export async function requireAdminScope(required: string[]) {
  const session = await getAdminSession();
  if (!session) {
    return {
      ok: false as const,
      response: NextResponse.json({ code: "40101", message: "unauthorized" }, { status: 401 }),
    };
  }
  const current = await getAdminUser(session.tenantId, session.userId);
  if (!current || current.status !== "active") {
    return {
      ok: false as const,
      response: NextResponse.json({ code: "40300", message: "forbidden" }, { status: 403 }),
    };
  }
  const scopes = current.scopes;
  if (!hasEveryScope(scopes, required)) {
    return {
      ok: false as const,
      response: NextResponse.json({ code: "40300", message: "forbidden" }, { status: 403 }),
    };
  }
  return { ok: true as const, session, scopes };
}

/** 命中任一 scope 即可（用于审计查询：read / read:all / read:dept）。 */
export async function requireAdminSomeScope(candidates: string[]) {
  const session = await getAdminSession();
  if (!session) {
    return {
      ok: false as const,
      response: NextResponse.json({ code: "40101", message: "unauthorized" }, { status: 401 }),
    };
  }
  const current = await getAdminUser(session.tenantId, session.userId);
  if (!current || current.status !== "active") {
    return {
      ok: false as const,
      response: NextResponse.json({ code: "40300", message: "forbidden" }, { status: 403 }),
    };
  }
  const scopes = current.scopes;
  if (!hasSomeScope(scopes, candidates)) {
    return {
      ok: false as const,
      response: NextResponse.json({ code: "40300", message: "forbidden" }, { status: 403 }),
    };
  }
  return { ok: true as const, session, scopes };
}
