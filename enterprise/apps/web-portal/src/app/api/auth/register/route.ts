import { NextResponse } from "next/server";
import { provisionUserFromAdmin } from "../../../../lib/auth-runtime";

function isEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const email = typeof body.email === "string" ? body.email : "";
    const displayName = typeof body.displayName === "string" ? body.displayName : "";
    const password = typeof body.password === "string" ? body.password : "";
    const tenantId = typeof process.env.DEFAULT_TENANT_ID === "string" ? process.env.DEFAULT_TENANT_ID : "";
    const deptId = typeof process.env.DEFAULT_DEPT_ID === "string" ? process.env.DEFAULT_DEPT_ID : null;

    if (!tenantId) {
      return NextResponse.json({ code: "50301", message: "register is disabled: DEFAULT_TENANT_ID missing" }, { status: 503 });
    }
    if (!isEmail(email)) {
      throw new Error("invalid email");
    }
    if (displayName.trim().length < 2) {
      throw new Error("displayName is too short");
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

