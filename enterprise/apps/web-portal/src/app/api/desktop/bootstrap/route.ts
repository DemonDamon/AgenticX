import { NextResponse } from "next/server";
import { listAvailableModelsForUser } from "../../../../lib/admin-providers-reader";
import { resolveDesktopIdentity } from "../../../../lib/desktop-auth";
import { loadDesktopManagedPolicy } from "../../../../lib/desktop-token-policy";

export async function GET(request: Request) {
  const identity = await resolveDesktopIdentity(request);
  if (!identity) {
    return NextResponse.json(
      { code: "40101", message: "企业登录已失效，请重新登录" },
      { status: 401 },
    );
  }

  const [models, managedPolicy] = await Promise.all([
    listAvailableModelsForUser(identity.userId, identity.email, identity.deptId),
    loadDesktopManagedPolicy(identity.tenantId),
  ]);

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
      capabilities: [],
      policy: {
        strict: true,
        tokenBudget: managedPolicy.tokenLimits,
        capabilities: managedPolicy.capabilities,
      },
    },
  });
}
