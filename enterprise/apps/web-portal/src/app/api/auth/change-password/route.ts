import { NextResponse } from "next/server";

import { completeRequiredPasswordChange } from "../../../../lib/auth-runtime";
import {
  ACCESS_COOKIE,
  REFRESH_COOKIE,
  getSessionFromCookies,
  isAuthCookieSecure,
  passwordChangeRequiredResponse,
} from "../../../../lib/session";

export async function POST(request: Request) {
  const session = await getSessionFromCookies();
  if (!session) {
    return NextResponse.json({ code: "40101", message: "unauthorized" }, { status: 401 });
  }
  if (!session.mustChangePassword) {
    return passwordChangeRequiredResponse();
  }

  let body: { newPassword?: unknown };
  try {
    body = (await request.json()) as { newPassword?: unknown };
  } catch {
    return NextResponse.json({ code: "40000", message: "invalid request" }, { status: 400 });
  }
  const newPassword = typeof body.newPassword === "string" ? body.newPassword : "";
  if (newPassword.length < 8) {
    return NextResponse.json(
      { code: "40000", message: "password must be at least 8 characters" },
      { status: 400 },
    );
  }

  try {
    const tokens = await completeRequiredPasswordChange(session, newPassword);
    const response = NextResponse.json({
      code: "00000",
      message: "ok",
      data: { expiresInSeconds: tokens.expiresInSeconds },
    });
    response.cookies.set(ACCESS_COOKIE, tokens.accessToken, {
      httpOnly: true,
      sameSite: "lax",
      secure: isAuthCookieSecure(),
      maxAge: tokens.expiresInSeconds,
      path: "/",
    });
    response.cookies.set(REFRESH_COOKIE, tokens.refreshToken, {
      httpOnly: true,
      sameSite: "lax",
      secure: isAuthCookieSecure(),
      maxAge: 7 * 24 * 60 * 60,
      path: "/",
    });
    return response;
  } catch {
    return NextResponse.json({ code: "40000", message: "password update failed" }, { status: 400 });
  }
}
