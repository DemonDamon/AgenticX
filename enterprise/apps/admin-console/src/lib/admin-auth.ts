import { hasEveryScope, aggregateScopesForUser } from "@agenticx/iam-core";
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

/** 基于 PG 角色聚合 scopes 的守卫；缺权 403 */
export async function requireAdminScope(required: string[]) {
  const session = await getAdminSession();
  if (!session) {
    return {
      ok: false as const,
      response: NextResponse.json({ code: "40101", message: "unauthorized" }, { status: 401 }),
    };
  }
  const scopes = await aggregateScopesForUser(session.tenantId, session.userId);
  if (!hasEveryScope(scopes, required)) {
    return {
      ok: false as const,
      response: NextResponse.json({ code: "40300", message: "forbidden" }, { status: 403 }),
    };
  }
  return { ok: true as const, session, scopes };
}
