import { NextResponse } from "next/server";
import { provisionUserFromAdmin } from "../../../../lib/auth-runtime";
import { getSessionFromCookies } from "../../../../lib/session";

function isEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export async function POST(request: Request) {
  try {
    const session = await getSessionFromCookies();
    if (!session || !session.scopes.includes("user:create")) {
      return NextResponse.json({ code: "40101", message: "unauthorized" }, { status: 401 });
    }

    const body = (await request.json()) as Record<string, unknown>;
    const requestedTenantId =
      typeof body.tenantId === "string" && body.tenantId.trim().length > 0 ? body.tenantId.trim() : session.tenantId;
    const allowCrossTenant = session.scopes.includes("tenant:manage:all");
    if (!allowCrossTenant && requestedTenantId !== session.tenantId) {
      return NextResponse.json({ code: "40301", message: "forbidden tenant scope" }, { status: 403 });
    }
    const tenantId = allowCrossTenant ? requestedTenantId : session.tenantId;
    const deptId = typeof body.deptId === "string" ? body.deptId : undefined;
    const email = typeof body.email === "string" ? body.email : "";
    const displayName = typeof body.displayName === "string" ? body.displayName : "";
    const password = typeof body.password === "string" ? body.password : "";

    if (!isEmail(email)) {
      throw new Error("invalid email");
    }
    if (!displayName) {
      throw new Error("displayName is required");
    }
    if (password.length < 8) {
      throw new Error("password must be at least 8 chars");
    }

    await provisionUserFromAdmin({
      tenantId,
      deptId,
      email,
      displayName,
      password,
      scopes: ["workspace:chat", "user:read"],
    });
    return NextResponse.json({ code: "00000", message: "ok" });
  } catch (error) {
    return NextResponse.json(
      {
        code: "40000",
        message: error instanceof Error ? error.message : "invalid request",
      },
      { status: 400 }
    );
  }
}

