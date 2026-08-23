import { NextResponse } from "next/server";
import { listAvailableModelsForUser } from "../../../../lib/admin-providers-reader";
import { listAvailableCapabilitiesForUser } from "../../../../lib/capability-packs-reader";
import { resolveDesktopIdentity } from "../../../../lib/desktop-auth";
import { loadDesktopManagedPolicy } from "../../../../lib/desktop-token-policy";

function isMissingCapabilityRelation(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /enterprise_capability_|enterprise_skills|enterprise_user_opt_outs|enterprise_user_groups|relation ["'`].*["'`] does not exist|ER_NO_SUCH_TABLE|doesn't exist/i.test(
    message,
  );
}

export async function GET(request: Request) {
  const identity = await resolveDesktopIdentity(request);
  if (!identity) {
    return NextResponse.json(
      { code: "40101", message: "企业登录已失效，请重新登录" },
      { status: 401 },
    );
  }

  const [models, managedPolicy, capabilities] = await Promise.all([
    listAvailableModelsForUser(identity.userId, identity.email, identity.deptId),
    loadDesktopManagedPolicy(identity.tenantId),
    listAvailableCapabilitiesForUser(
      identity.userId,
      identity.email,
      identity.deptId,
      "desktop",
    ).catch((error) => {
      if (isMissingCapabilityRelation(error)) return [];
      throw error;
    }),
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
      capabilities,
      policy: {
        strict: true,
        tokenBudget: managedPolicy.tokenLimits,
        capabilities: managedPolicy.capabilities,
      },
    },
  });
}
