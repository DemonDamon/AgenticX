import { getProviderDisplayName, type ProviderDisplayEntry } from "./provider-display";

/** Strip LiteLLM / gateway routing prefixes such as openai/deepseek-r1. */
export function normalizeBareModelId(model: string): string {
  const trimmed = model.trim();
  const slash = trimmed.indexOf("/");
  if (slash > 0) return trimmed.slice(slash + 1).trim();
  return trimmed;
}

export type ModelDisplayParts = {
  /** Bare model id, e.g. `kimi-k2.6`. */
  modelName: string;
  /** Configured vendor label, e.g. `月之暗面`. */
  providerLabel: string;
};

/** Split the flat `vendor/model` label so UI can rank model name over routing vendor. */
export function formatModelDisplayParts(
  providerId: string,
  model: string,
  entry?: ProviderDisplayEntry | null,
): ModelDisplayParts {
  return {
    modelName: normalizeBareModelId(model),
    providerLabel: getProviderDisplayName(providerId, entry),
  };
}

/** User-facing label: always reflect configured provider, never infer an unconfigured vendor from model id. */
export function formatModelOptionLabel(
  providerId: string,
  model: string,
  entry?: ProviderDisplayEntry | null,
  separator = "/",
): string {
  const bare = normalizeBareModelId(model);
  if (!bare) return "未选模型";
  const provLabel = getProviderDisplayName(providerId, entry);
  return `${provLabel}${separator}${bare}`;
}
