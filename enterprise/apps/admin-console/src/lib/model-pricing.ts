export type ModelPricingEntry = {
  tier?: string;
  input: number;
  output: number;
  cachedInput?: number;
  cacheCreation?: number;
  cacheRead?: number;
  reasoningOutput?: number;
  inputPerM?: number;
  outputPerM?: number;
  reasoningPerM?: number;
  effectiveDate?: string;
};

export type PricingConfig = {
  version: string;
  default: ModelPricingEntry;
  models: Record<string, ModelPricingEntry[]>;
  updatedAt: string;
};

export type PricingCatalogProvider = {
  id: string;
  models: Array<{ name: string }>;
};

export function providerModelPricingKey(providerId: string, modelName: string): string {
  return `${providerId.trim()}/${modelName.trim()}`;
}

function finiteNonNegative(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

export function pricePerMillion(entry: ModelPricingEntry, kind: "input" | "output"): number {
  const explicit = kind === "input" ? entry.inputPerM : entry.outputPerM;
  if (explicit != null && Number.isFinite(Number(explicit))) return finiteNonNegative(explicit);
  return finiteNonNegative(entry[kind]) * 1_000_000;
}

export function resolveProviderModelPricing(
  config: PricingConfig,
  providerId: string,
  modelName: string,
): ModelPricingEntry {
  const exact = config.models[providerModelPricingKey(providerId, modelName)]?.[0];
  const legacy = config.models[modelName]?.[0];
  return { ...(exact ?? legacy ?? config.default) };
}

function normalizedPerMillionEntry(entry: ModelPricingEntry): ModelPricingEntry {
  const inputPerM = pricePerMillion(entry, "input");
  const outputPerM = pricePerMillion(entry, "output");
  return {
    ...entry,
    input: inputPerM / 1_000_000,
    output: outputPerM / 1_000_000,
    inputPerM,
    outputPerM,
  };
}

/**
 * Rebuilds pricing from the persisted provider catalog. Admins never type model
 * identifiers here: new provider models inherit the current default/legacy rate,
 * and removed provider models disappear from the next published snapshot.
 */
export function syncPricingToProviderCatalog(
  config: PricingConfig,
  providers: PricingCatalogProvider[],
): PricingConfig {
  const models: Record<string, ModelPricingEntry[]> = {};
  for (const provider of providers) {
    for (const model of provider.models) {
      const providerId = provider.id.trim();
      const modelName = model.name.trim();
      if (!providerId || !modelName) continue;
      const key = providerModelPricingKey(providerId, modelName);
      models[key] = [normalizedPerMillionEntry(resolveProviderModelPricing(config, providerId, modelName))];
    }
  }
  return { ...config, models };
}

export function updateProviderModelPrice(
  config: PricingConfig,
  providerId: string,
  modelName: string,
  kind: "input" | "output",
  perMillion: number,
): PricingConfig {
  const key = providerModelPricingKey(providerId, modelName);
  const current = normalizedPerMillionEntry(resolveProviderModelPricing(config, providerId, modelName));
  const nextPerM = finiteNonNegative(perMillion);
  const next: ModelPricingEntry = {
    ...current,
    [kind]: nextPerM / 1_000_000,
    [kind === "input" ? "inputPerM" : "outputPerM"]: nextPerM,
  };
  return {
    ...config,
    models: { ...config.models, [key]: [next] },
  };
}
