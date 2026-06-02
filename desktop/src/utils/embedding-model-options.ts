import { classifyModelKind, isEmbeddingModelKind } from "./model-kind";
import {
  listProviderVisibleModelIds,
  type ProviderCatalogEntry,
} from "./model-options";
/** Fallback when model-service has no visible embedding SKUs yet. */
const KB_EMBEDDING_DEFAULT_MODEL: Record<string, string> = {
  ollama: "bge-m3",
  openai: "text-embedding-3-small",
  siliconflow: "BAAI/bge-m3",
  bailian: "text-embedding-v4",
};

/** KB `embedding.provider` id → model-service catalog match rules. */
const KB_TO_CATALOG: Record<
  string,
  { keys?: string[]; baseUrlIncludes?: string[] }
> = {
  bailian: { keys: ["bailian", "dashscope"], baseUrlIncludes: ["dashscope.aliyuncs.com"] },
  openai: { keys: ["openai"], baseUrlIncludes: ["api.openai.com"] },
  ollama: { keys: ["ollama"], baseUrlIncludes: [":11434", "ollama"] },
  siliconflow: { keys: ["siliconflow"], baseUrlIncludes: ["siliconflow"] },
};

/** Model-service provider keys that map to a KB embedding provider. */
export function resolveCatalogProviderKeysForKb(
  kbProviderId: string,
  providers: Record<string, ProviderCatalogEntry>,
): string[] {
  const spec = KB_TO_CATALOG[kbProviderId];
  if (!spec) return [];
  const matched = new Set<string>();
  for (const [key, entry] of Object.entries(providers)) {
    if (entry.enabled === false) continue;
    if (spec.keys?.includes(key)) {
      matched.add(key);
      continue;
    }
    const base = (entry.baseUrl ?? "").toLowerCase();
    if (spec.baseUrlIncludes?.some((hint) => base.includes(hint))) {
      matched.add(key);
    }
  }
  return Array.from(matched);
}

/**
 * Embedding model ids from model-service visible lists (post scan), filtered by
 * kind. Falls back to KB preset default when the catalog has no embedding rows.
 */
export function listKbEmbeddingModelOptions(
  kbProviderId: string,
  providers: Record<string, ProviderCatalogEntry>,
  currentModel = "",
): string[] {
  const set = new Set<string>();
  for (const catalogKey of resolveCatalogProviderKeysForKb(kbProviderId, providers)) {
    const entry = providers[catalogKey];
    if (!entry) continue;
    for (const model of listProviderVisibleModelIds(entry)) {
      if (isEmbeddingModelKind(classifyModelKind(catalogKey, model))) {
        set.add(model);
      }
    }
  }
  const cur = currentModel.trim();
  if (cur) set.add(cur);

  const fallback = KB_EMBEDDING_DEFAULT_MODEL[kbProviderId];
  if (fallback && set.size === 0) set.add(fallback);

  return Array.from(set).sort((a, b) => a.localeCompare(b));
}
