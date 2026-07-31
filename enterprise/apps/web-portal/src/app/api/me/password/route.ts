import { NextResponse } from "next/server";

import { changeCurrentPassword, verifyCurrentPassword } from "../../../../lib/auth-runtime";
import {
  ACCESS_COOKIE,
  REFRESH_COOKIE,
  getSessionFromCookies,
  isAuthCookieSecure,
  passwordChangeRequiredResponse,
} from "../../../../lib/session";

function unauthorizedResponse() {
  return NextResponse.json({ code: "40101", message: "unauthorized" }, { status: 401 });
}

async function readPasswordBody(request: Request): Promise<{
  currentPassword: string;
  newPassword?: string;
} | null> {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    return {
      currentPassword: typeof body.currentPassword === "string" ? body.currentPassword : "",
      newPassword: typeof body.newPassword === "string" ? body.newPassword : undefined,
    };
  } catch {
    return null;
  }
}

export async function POST(request: Request) {
  const session = await getSessionFromCookies();
  if (session?.mustChangePassword) return passwordChangeRequiredResponse();
  if (!session) return unauthorizedResponse();

  const body = await readPasswordBody(request);
  if (!body?.currentPassword) {
    return NextResponse.json({ code: "40000", message: "current password is required" }, { status: 400 });
  }

  try {
    await verifyCurrentPassword(session, body.currentPassword);
    return NextResponse.json({ code: "00000", message: "ok", data: { valid: true } });
  } catch {
    return NextResponse.json(
      { code: "40001", message: "invalid current password", data: { valid: false } },
      { status: 400 },
    );
  }
}

export async function PUT(request: Request) {
  const session = await getSessionFromCookies();
  if (session?.mustChangePassword) return passwordChangeRequiredResponse();
  if (!session) return unauthorizedResponse();

  const body = await readPasswordBody(request);
  const currentPassword = body?.currentPassword ?? "";
  const newPassword = body?.newPassword ?? "";
  if (!currentPassword) {
    return NextResponse.json({ code: "40000", message: "current password is required" }, { status: 400 });
  }
  if (newPassword.length < 8) {
    return NextResponse.json(
      { code: "40000", message: "password must be at least 8 characters" },
      { status: 400 },
    );
  }

  try {
    const tokens = await changeCurrentPassword(session, currentPassword, newPassword);
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
    return NextResponse.json({ code: "40001", message: "password update failed" }, { status: 400 });
  }
}
