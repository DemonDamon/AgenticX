import { NextResponse } from "next/server";
import { listAvailableModelsForUser } from "../../../../lib/admin-providers-reader";
import { resolveDesktopIdentity } from "../../../../lib/desktop-auth";

export async function GET(request: Request) {
  const identity = await resolveDesktopIdentity(request);
  if (!identity) {
    return NextResponse.json(
      { code: "40101", message: "企业登录已失效，请重新登录" },
      { status: 401 },
    );
  }

  const models = await listAvailableModelsForUser(
    identity.userId,
    identity.email,
    identity.deptId,
  );

  const origin = new URL(request.url).origin;
  return NextResponse.json({
    code: "00000",
    message: "ok",
    data: {
      user: {
        userId: identity.userId,
        email: identity.email,
        displayName: identity.displayName,
        tenantId: identity.tenantId,
        deptId: identity.deptId,
      },
      models,
      policy: { strict: true },
      apiBaseUrl: `${origin}/api/desktop/v1`,
    },
  });
}
