import { NextResponse } from "next/server";
import { createPat } from "@agenticx/iam-core";
import { loginAndGetIdentity } from "../../../../../lib/auth-runtime";
import { DESKTOP_MANAGED_PAT_SCOPES } from "../../../../../lib/desktop-auth";

function desktopPatExpireDays(): number {
  const raw = Number(process.env.DESKTOP_PAT_EXPIRE_DAYS ?? "90");
  if (!Number.isFinite(raw) || raw <= 0) return 90;
  return Math.floor(raw);
}

export async function POST(request: Request) {
  let body: { email?: string; password?: string; deviceName?: string };
  try {
    body = (await request.json()) as { email?: string; password?: string; deviceName?: string };
  } catch {
    return NextResponse.json(
      { code: "40000", message: "invalid json body" },
      { status: 400 },
    );
  }

  const email = typeof body.email === "string" ? body.email.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";
  if (!email || !password) {
    return NextResponse.json(
      { code: "40000", message: "email and password are required" },
      { status: 400 },
    );
  }

  let identity: Awaited<ReturnType<typeof loginAndGetIdentity>>;
  try {
    identity = await loginAndGetIdentity(email, password);
  } catch {
    return NextResponse.json(
      { code: "40101", message: "邮箱或密码错误" },
      { status: 401 },
    );
  }

  const deviceName = (body.deviceName ?? "unknown").trim() || "unknown";
  const expireDays = desktopPatExpireDays();
  try {
    const result = await createPat({
      tenantId: identity.tenantId,
      userId: identity.userId,
      deptId: identity.deptId,
      name: `和创智派 Desktop · ${deviceName}`,
      createdBy: identity.userId,
      expireDays,
      scopes: [...DESKTOP_MANAGED_PAT_SCOPES],
    });
    const expiresAt = new Date(Date.now() + expireDays * 24 * 60 * 60 * 1000).toISOString();
    return NextResponse.json({
      code: "00000",
      message: "ok",
      data: {
        token: result.token,
        tokenId: result.record.id,
        user: {
          userId: identity.userId,
          email: identity.email,
          displayName: identity.displayName,
          tenantId: identity.tenantId,
          deptId: identity.deptId,
        },
        expiresAt,
      },
    });
  } catch (error) {
    console.error("[desktop/auth/token] createPat failed:", error);
    return NextResponse.json(
      { code: "50000", message: "failed to issue device token" },
      { status: 500 },
    );
  }
}
