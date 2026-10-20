import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { refreshTokens, verifyAccessToken } from "../../../../lib/auth-runtime";
import { ACCESS_COOKIE, REFRESH_COOKIE, isAuthCookieSecure } from "../../../../lib/session";

export const runtime = "nodejs";

function unauthorized(): NextResponse {
  return NextResponse.json(
    { code: "40101", message: "unauthorized" },
    { status: 401, headers: { "cache-control": "no-store" } },
  );
}

function expiresAtIso(accessToken: string, expiresInSeconds: number): string {
  const payload = accessToken.split(".")[1];
  if (payload) {
    try {
      const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
        exp?: unknown;
      };
      if (typeof parsed.exp === "number" && Number.isFinite(parsed.exp)) {
        return new Date(parsed.exp * 1000).toISOString();
      }
    } catch {
      // Fall back to the refresh response lifetime.
    }
  }
  return new Date(Date.now() + expiresInSeconds * 1000).toISOString();
}

function writeAuthCookies(
  response: NextResponse,
  accessToken: string,
  refreshToken: string,
  accessMaxAge: number,
): NextResponse {
  response.cookies.set(ACCESS_COOKIE, accessToken, {
    httpOnly: true,
    sameSite: "lax",
    secure: isAuthCookieSecure(),
    maxAge: accessMaxAge,
    path: "/",
  });
  response.cookies.set(REFRESH_COOKIE, refreshToken, {
    httpOnly: true,
    sameSite: "lax",
    secure: isAuthCookieSecure(),
    maxAge: 7 * 24 * 60 * 60,
    path: "/",
  });
  return response;
}

/** Exchange the refresh cookie for a new access token and write both cookies back. */
export async function GET(request: Request): Promise<NextResponse> {
  // Omitted format is treated as json. This route does not navigate.
  const format = new URL(request.url).searchParams.get("format") ?? "json";
  if (format !== "json") return unauthorized();
  const cookieStore = await cookies();
  const refreshToken = cookieStore.get(REFRESH_COOKIE)?.value;
  if (!refreshToken) return unauthorized();

  try {
    const next = await refreshTokens(refreshToken);
    const context = await verifyAccessToken(next.accessToken);
    if (!context) return unauthorized();
    const response = NextResponse.json(
      {
        code: "00000",
        message: "ok",
        data: {
          tenantId: context.tenantId,
          userId: context.userId,
          expiresAt: expiresAtIso(next.accessToken, next.expiresInSeconds),
        },
      },
      { headers: { "cache-control": "no-store" } },
    );
    return writeAuthCookies(response, next.accessToken, next.refreshToken, next.expiresInSeconds);
  } catch {
    return unauthorized();
  }
}
