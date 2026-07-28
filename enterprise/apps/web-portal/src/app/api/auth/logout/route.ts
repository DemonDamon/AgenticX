import { NextResponse } from "next/server";
import { ACCESS_COOKIE, REFRESH_COOKIE, isAuthCookieSecure } from "../../../../lib/session";

export async function POST() {
  const response = NextResponse.json({ code: "00000", message: "ok" });
  const secure = isAuthCookieSecure();
  response.cookies.set(ACCESS_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure,
    path: "/",
    maxAge: 0,
  });
  response.cookies.set(REFRESH_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure,
    path: "/",
    maxAge: 0,
  });
  return response;
}

