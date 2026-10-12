import { NextResponse } from "next/server";
import { listAvailableModelsForUser } from "../../../../lib/admin-providers-reader";
import { listAvailableCapabilitiesForUser } from "../../../../lib/capability-packs-reader";
import { resolveDesktopIdentity } from "../../../../lib/desktop-auth";
import { loadDesktopAgentPolicy } from "../../../../lib/desktop-agent-policy-reader";
import { loadDesktopManagedPolicy } from "../../../../lib/desktop-token-policy";

const DEFAULT_AGENT_ACTIONS = {
  deniedTools: [] as string[],
  alwaysAskTools: [] as string[],
  disableSessionAllow: false,
};

function isMissingCapabilityRelation(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /enterprise_capability_|enterprise_skills|enterprise_user_opt_outs|enterprise_user_groups|enterprise_desktop_agent_policies|relation ["'`].*["'`] does not exist|ER_NO_SUCH_TABLE|doesn't exist/i.test(
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

  const [models, managedPolicy, capabilities, agentActions] = await Promise.all([
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
    loadDesktopAgentPolicy(identity.tenantId).catch((error) => {
      if (isMissingCapabilityRelation(error)) {
        console.warn("[desktop-bootstrap] agent action policy unavailable; using defaults", error);
        return { ...DEFAULT_AGENT_ACTIONS };
      }
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
        agentActions,
      },
    },
  });
}
