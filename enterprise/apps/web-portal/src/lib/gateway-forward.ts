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
 * Enforce live visibility for managed Desktop models.
 *
 * Keep the model id intact for the gateway. Some managed model ids contain
 * nested slashes, e.g. "chinamobile/kimi/kimi-k3"; splitting them here would
 * make the gateway see a mismatched provider header and body model.
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
    }
  } catch {
    // non-JSON body: forward as-is
  }
  return { forwardBody, providerHint };
}
