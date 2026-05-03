import { loadAuthUserByEmail } from "@agenticx/iam-core";
import { cookies } from "next/headers";
import { refreshTokens, verifyAccessToken } from "./auth-runtime";

export const ACCESS_COOKIE = "agenticx_access_token";
export const REFRESH_COOKIE = "agenticx_refresh_token";

async function hydrateFromDatabase<T extends { tenantId: string; email: string; scopes: string[]; deptId?: string | null }>(
  context: T
): Promise<T | null> {
  if (!process.env.DATABASE_URL?.trim()) return context;
  const live = await loadAuthUserByEmail(context.tenantId, context.email);
  if (!live || live.status === "disabled") return null;
  if (live.status === "locked") return null;
  if (live.lockedUntil && live.lockedUntil > Date.now()) return null;
  return {
    ...context,
    scopes: live.scopes,
    deptId: live.deptId ?? null,
  };
}

export async function getSessionFromCookies() {
  const cookieStore = await cookies();
  const accessToken = cookieStore.get(ACCESS_COOKIE)?.value;
  if (accessToken) {
    const context = await verifyAccessToken(accessToken);
    if (context) {
      const hydrated = await hydrateFromDatabase(context);
      if (hydrated) return hydrated;
      return null;
    }
  }

  const refreshToken = cookieStore.get(REFRESH_COOKIE)?.value;
  if (!refreshToken) return null;

  try {
    const nextTokens = await refreshTokens(refreshToken);
    const refreshed = await verifyAccessToken(nextTokens.accessToken);
    if (!refreshed) return null;
    const hydrated = await hydrateFromDatabase(refreshed);
    if (!hydrated) {
      return null;
    }
    cookieStore.set(ACCESS_COOKIE, nextTokens.accessToken, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: nextTokens.expiresInSeconds,
      path: "/",
    });
    cookieStore.set(REFRESH_COOKIE, nextTokens.refreshToken, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 7 * 24 * 60 * 60,
      path: "/",
    });
    return hydrated;
  } catch {
    return null;
  }
}

