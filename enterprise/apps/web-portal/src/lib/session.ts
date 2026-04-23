import { cookies } from "next/headers";
import { refreshTokens, verifyAccessToken } from "./auth-runtime";

export const ACCESS_COOKIE = "agenticx_access_token";
export const REFRESH_COOKIE = "agenticx_refresh_token";

export async function getSessionFromCookies() {
  const cookieStore = await cookies();
  const accessToken = cookieStore.get(ACCESS_COOKIE)?.value;
  if (accessToken) {
    const context = await verifyAccessToken(accessToken);
    if (context) return context;
  }

  const refreshToken = cookieStore.get(REFRESH_COOKIE)?.value;
  if (!refreshToken) return null;

  try {
    const nextTokens = await refreshTokens(refreshToken);
    const refreshed = await verifyAccessToken(nextTokens.accessToken);
    if (!refreshed) return null;
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
    return refreshed;
  } catch {
    return null;
  }
}

