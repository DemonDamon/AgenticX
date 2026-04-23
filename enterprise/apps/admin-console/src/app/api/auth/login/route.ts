import { NextResponse } from "next/server";
import { ADMIN_SESSION_COOKIE, createAdminSessionToken, resolveAdminCredentials } from "../../../../lib/admin-session";

export async function POST(request: Request) {
  let body: { email?: string; password?: string };
  try {
    body = (await request.json()) as { email?: string; password?: string };
  } catch {
    return NextResponse.json({ code: "40001", message: "invalid json" }, { status: 400 });
  }
  if (!body.email || !body.password) {
    return NextResponse.json({ code: "40100", message: "invalid credentials" }, { status: 401 });
  }
  const credentials = resolveAdminCredentials();
  if (!credentials) {
    return NextResponse.json({ code: "50300", message: "admin login is not configured" }, { status: 503 });
  }
  if (body.email !== credentials.email || body.password !== credentials.password) {
    return NextResponse.json({ code: "40100", message: "invalid credentials" }, { status: 401 });
  }

  const token = createAdminSessionToken(body.email);
  const response = NextResponse.json({ code: "00000", message: "ok" });
  response.cookies.set(ADMIN_SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 8,
  });
  return response;
}

