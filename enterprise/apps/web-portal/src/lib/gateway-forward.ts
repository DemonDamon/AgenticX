import { listAvailableModelsForUser } from "./admin-providers-reader";

export type GatewayForwardIdentity = {
  userId: string;
  email: string;
  deptId?: string | null;
};

export type PrepareGatewayForwardResult =
  | { forwardBody: string; providerHint: string }
  | { error: { status: number; code: string; message: string } };

/**
 * Split "<providerId>/<modelName>" for the gateway and enforce live visibility.
 * Shared by Desktop chat proxy (browser route left untouched per no-scope-creep).
 */
export async function prepareGatewayForward(
  rawBody: string,
  identity: GatewayForwardIdentity,
): Promise<PrepareGatewayForwardResult> {
  let providerHint = "";
  let forwardBody = rawBody;
  try {
    const parsed = JSON.parse(rawBody) as { model?: string };
    if (typeof parsed.model === "string" && parsed.model.includes("/")) {
      const effectiveModels = await listAvailableModelsForUser(
        identity.userId,
        identity.email,
        identity.deptId ?? undefined,
      );
      const isVisible = effectiveModels.some((m) => m.id === parsed.model);
      if (!isVisible) {
        return {
          error: {
            status: 403,
            code: "40301",
            message: "该模型已不在您的可见范围内，请刷新模型列表后重新选择",
          },
        };
      }
      const [providerId, ...rest] = parsed.model.split("/");
      const modelName = rest.join("/");
      if (providerId && modelName) {
        providerHint = providerId;
        forwardBody = JSON.stringify({ ...parsed, model: modelName });
      }
    }
  } catch {
    // non-JSON body: forward as-is
  }
  return { forwardBody, providerHint };
}
