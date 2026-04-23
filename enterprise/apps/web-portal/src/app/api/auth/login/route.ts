import { NextResponse } from "next/server";
import { loginWithPassword } from "../../../../lib/auth-runtime";
import { ACCESS_COOKIE, REFRESH_COOKIE } from "../../../../lib/session";

function isEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const email = typeof body.email === "string" ? body.email : "";
    const password = typeof body.password === "string" ? body.password : "";
    if (!isEmail(email) || !password) {
      throw new Error("invalid credentials");
    }
    const tokens = await loginWithPassword(email, password);
    const response = NextResponse.json({ code: "00000", message: "ok", data: { expiresInSeconds: tokens.expiresInSeconds } });
    response.cookies.set(ACCESS_COOKIE, tokens.accessToken, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: tokens.expiresInSeconds,
      path: "/",
    });
    response.cookies.set(REFRESH_COOKIE, tokens.refreshToken, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 7 * 24 * 60 * 60,
      path: "/",
    });
    return response;
  } catch (error) {
    return NextResponse.json(
      {
        code: "40100",
        message: error instanceof Error ? error.message : "invalid credentials",
      },
      { status: 401 }
    );
  }
}

