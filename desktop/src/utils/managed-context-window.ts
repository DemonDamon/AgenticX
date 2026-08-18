import type { ManagedModelCatalogEntry } from "./model-options";

type ProviderCatalogLike = { modelCatalog?: ManagedModelCatalogEntry[] };

/**
 * 企业管理员为该模型声明的上下文窗口。
 *
 * 托管厂商下发的目录里，条目 id 就是请求实际使用的完整模型 id（`zhipu/glm-5.2`），
 * 所以直接按 id 比对即可；自配置厂商没有目录，返回 undefined 交给后端按模型名兜底。
 */
export function resolveManagedContextWindow(
  providers: Record<string, ProviderCatalogLike> | undefined,
  provider: string,
  model: string,
): number | undefined {
  const modelId = (model || "").trim();
  if (!providers || !modelId) return undefined;
  const catalog = providers[(provider || "").trim()]?.modelCatalog;
  if (!Array.isArray(catalog)) return undefined;
  const hit = catalog.find((item) => (item?.id || "").trim() === modelId);
  const declared = hit?.contextWindow;
  return typeof declared === "number" && Number.isFinite(declared) && declared > 0
    ? Math.floor(declared)
    : undefined;
}
