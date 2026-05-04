import { NextResponse } from "next/server";
import { loginWithPassword } from "../../../../lib/auth-runtime";
import { ACCESS_COOKIE, REFRESH_COOKIE } from "../../../../lib/session";

function isEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function resolveLoginError(error: unknown): { status: number; code: string; message: string } {
  if (!(error instanceof Error)) {
    return { status: 401, code: "40100", message: "invalid credentials" };
  }
  const raw = `${error.message}\n${String((error as { cause?: unknown }).cause ?? "")}`.toLowerCase();
  if (raw.includes("column") && raw.includes("does not exist")) {
    return { status: 503, code: "50300", message: "service temporarily unavailable" };
  }
  if (raw.includes("invalid credentials")) {
    return { status: 401, code: "40100", message: "invalid credentials" };
  }
  return { status: 401, code: "40100", message: "invalid credentials" };
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
    const resolved = resolveLoginError(error);
    return NextResponse.json(
      {
        code: resolved.code,
        message: resolved.message,
      },
      { status: resolved.status }
    );
  }
}

