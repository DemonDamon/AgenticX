import { NextResponse } from "next/server";
import { listAvailableModelsForUser } from "../../../../lib/admin-providers-reader";
import {
  findUnmetSkillDependencies,
  listAvailableCapabilitiesForUser,
} from "../../../../lib/capability-packs-reader";
import { resolveDesktopIdentity } from "../../../../lib/desktop-auth";
import { withGatewayMcpEndpoints } from "../../../../lib/desktop-capability-endpoints";
import { resolveDesktopInferenceApiBase } from "../../../../lib/desktop-inference-base";
import { requestOriginFromRequest } from "../../../../lib/desktop-device-auth";
import { loadDesktopManagedPolicy } from "../../../../lib/desktop-token-policy";

export async function GET(request: Request) {
  const identity = await resolveDesktopIdentity(request);
  if (!identity) {
    return NextResponse.json(
      { code: "40101", message: "企业登录已失效，请重新登录" },
      { status: 401 },
    );
  }

  const [models, managedPolicy, capabilities] = await Promise.all([
    listAvailableModelsForUser(
      identity.userId,
      identity.email,
      identity.deptId,
    ),
    loadDesktopManagedPolicy(identity.tenantId),
    // 能力包尚未迁移的租户不应因此拿不到模型，登录照常，能力为空。
    listAvailableCapabilitiesForUser(
      identity.userId,
      identity.email,
      identity.deptId,
    ).catch(() => []),
  ]);

  const { tokenLimits: tokenBudget, capabilities: capabilityPolicy } = managedPolicy;

  const origin = requestOriginFromRequest(request);
  const apiBaseUrl = `${origin}/api/desktop/v1`;
  const directEligible = identity.scopes.includes("desktop:managed");

  const data: Record<string, unknown> = {
    user: {
      userId: identity.userId,
      email: identity.email,
      displayName: identity.displayName,
      tenantId: identity.tenantId,
      deptId: identity.deptId,
    },
    models,
    capabilities: withGatewayMcpEndpoints(capabilities),
    // 依赖没随包一起下发时 Desktop 装了也调不通，这里标出来供前端提示。
    unmetCapabilityDependencies: findUnmetSkillDependencies(capabilities),
    policy: { strict: true, tokenBudget, capabilities: capabilityPolicy },
    apiBaseUrl,
    reauthRequiredForDirect: !directEligible,
  };

  if (directEligible) {
    const inference = resolveDesktopInferenceApiBase({
      configured: process.env.NEXT_PUBLIC_GATEWAY_PUBLIC_BASE_URL,
      nodeEnv: process.env.NODE_ENV,
    });
    if (inference.ok) {
      data.inferenceApiBaseUrl = inference.url;
      data.inferenceTransport = "gateway-direct-v1";
    } else {
      data.reauthRequiredForDirect = true;
    }
  }

  return NextResponse.json({
    code: "00000",
    message: "ok",
    data,
  });
}
