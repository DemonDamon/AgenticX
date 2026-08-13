import { NextResponse } from "next/server";
import { listAvailableModelsForUser } from "../../../../lib/admin-providers-reader";
import { resolveDesktopIdentity } from "../../../../lib/desktop-auth";
import { resolveDesktopInferenceApiBase } from "../../../../lib/desktop-inference-base";
import { requestOriginFromRequest } from "../../../../lib/desktop-device-auth";

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
    policy: { strict: true },
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
