import { NextResponse } from "next/server";
import { listAvailableModelsForUser } from "../../../../lib/admin-providers-reader";
import { resolveDesktopIdentity } from "../../../../lib/desktop-auth";
import { resolveDesktopInferenceApiBase } from "../../../../lib/desktop-inference-base";

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
    if (!inference.ok) {
      return NextResponse.json(
        { code: "50302", message: "企业推理入口未配置，请联系管理员" },
        { status: 503 },
      );
    }
    data.inferenceApiBaseUrl = inference.url;
    data.inferenceTransport = "gateway-direct-v1";
  }

  return NextResponse.json({
    code: "00000",
    message: "ok",
    data,
  });
}
