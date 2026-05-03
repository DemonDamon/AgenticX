import { NextResponse } from "next/server";
import {
  ADMIN_SESSION_COOKIE,
  createAdminSessionToken,
  resolveAdminCredentials,
} from "../../../../lib/admin-session";
import { authenticateAdminConsoleUser } from "../../../../lib/admin-pg-auth";

function getDefaultTenantId(): string | null {
  return process.env.DEFAULT_TENANT_ID?.trim() || null;
}

function jsonWithSessionCookie(email: string, userId: string, tenantId: string) {
  const token = createAdminSessionToken(email, userId, tenantId);
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

  const tenantId = getDefaultTenantId();
  const databaseUrl = process.env.DATABASE_URL?.trim();
  const isProd = process.env.NODE_ENV === "production";

  if (isProd && (!databaseUrl || !tenantId)) {
    return NextResponse.json(
      {
        code: "50300",
        message: "DATABASE_URL and DEFAULT_TENANT_ID are required in production",
      },
      { status: 503 }
    );
  }

  if (databaseUrl && tenantId) {
    const authed = await authenticateAdminConsoleUser({
      email: body.email,
      password: body.password,
      tenantId,
    });
    if (!authed) {
      return NextResponse.json({ code: "40100", message: "invalid credentials" }, { status: 401 });
    }
    return jsonWithSessionCookie(authed.email, authed.userId, authed.tenantId);
  }

  if (isProd) {
    return NextResponse.json(
      { code: "50300", message: "admin login requires PostgreSQL configuration in production" },
      { status: 503 }
    );
  }

  const credentials = resolveAdminCredentials();
  if (!credentials) {
    return NextResponse.json({ code: "50300", message: "admin login is not configured" }, { status: 503 });
  }
  if (body.email !== credentials.email || body.password !== credentials.password) {
    return NextResponse.json({ code: "40100", message: "invalid credentials" }, { status: 401 });
  }

  if (!tenantId) {
    return NextResponse.json({ code: "50300", message: "DEFAULT_TENANT_ID is required" }, { status: 503 });
  }

  return jsonWithSessionCookie(credentials.email, "01J00000000000000000000004", tenantId);
}
