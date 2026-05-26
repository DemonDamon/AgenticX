import { formatModelOptionLabel, normalizeBareModelId } from "./model-display";

export type ProviderCatalogEntry = {
  apiKey: string;
  baseUrl: string;
  model: string;
  models: string[];
  enabled: boolean;
  dropParams: boolean;
  displayName?: string;
  interface?: "openai";
};

export type SelectableModelOption = {
  provider: string;
  model: string;
  label: string;
};

/** Models the user can pick for a provider: visible list wins over legacy `model`. */
export function listProviderVisibleModelIds(entry: ProviderCatalogEntry): string[] {
  const models = (entry.models ?? []).map((m) => m.trim()).filter(Boolean);
  if (models.length > 0) return models;
  const single = (entry.model ?? "").trim();
  return single ? [single] : [];
}

/** Keep legacy `model` aligned with the visible catalog. */
export function normalizeProviderEntry(entry: ProviderCatalogEntry): ProviderCatalogEntry {
  const models = (entry.models ?? []).map((m) => m.trim()).filter(Boolean);
  let model = (entry.model ?? "").trim();
  if (models.length > 0) {
    if (!models.includes(model)) model = models[0] ?? "";
  }
  return { ...entry, model, models };
}

export function normalizeAllProviders(
  providers: Record<string, ProviderCatalogEntry>,
): Record<string, ProviderCatalogEntry> {
  const out: Record<string, ProviderCatalogEntry> = {};
  for (const [name, entry] of Object.entries(providers)) {
    out[name] = normalizeProviderEntry(entry);
  }
  return out;
}

function providerPassesPickerGate(entry: ProviderCatalogEntry): boolean {
  if (entry.enabled === false) return false;
  return Boolean((entry.apiKey ?? "").trim());
}

export function isModelInProviderCatalog(
  providerId: string,
  modelId: string,
  providers: Record<string, ProviderCatalogEntry>,
): boolean {
  const entry = providers[providerId];
  if (!entry || entry.enabled === false) return false;
  const bare = normalizeBareModelId(modelId);
  if (!bare) return false;
  return listProviderVisibleModelIds(entry).some(
    (candidate) => normalizeBareModelId(candidate) === bare,
  );
}

/** Same rules as chat/automation model pickers. */
export function isModelSelectable(
  providerId: string,
  modelId: string,
  providers: Record<string, ProviderCatalogEntry>,
): boolean {
  if (!isModelInProviderCatalog(providerId, modelId, providers)) return false;
  const entry = providers[providerId];
  if (!entry) return false;
  return providerPassesPickerGate(entry);
}

export function canonicalizeCatalogModel(
  providerId: string,
  modelId: string,
  providers: Record<string, ProviderCatalogEntry>,
): string | null {
  const entry = providers[providerId];
  if (!entry) return null;
  const bare = normalizeBareModelId(modelId);
  if (!bare) return null;
  const hit = listProviderVisibleModelIds(entry).find(
    (candidate) => normalizeBareModelId(candidate) === bare,
  );
  return hit ?? null;
}

export function collectSelectableModelOptions(
  providers: Record<string, ProviderCatalogEntry>,
  separator = "/",
): SelectableModelOption[] {
  const result: SelectableModelOption[] = [];
  for (const [provName, entry] of Object.entries(providers)) {
    if (!providerPassesPickerGate(entry)) continue;
    for (const model of listProviderVisibleModelIds(entry)) {
      result.push({
        provider: provName,
        model,
        label: formatModelOptionLabel(provName, model, entry, separator),
      });
    }
  }
  return result;
}

export function resolveFallbackModel(
  providers: Record<string, ProviderCatalogEntry>,
  preferredProvider?: string,
): { provider: string; model: string } | null {
  const options = collectSelectableModelOptions(providers);
  if (options.length === 0) return null;
  const pref = (preferredProvider ?? "").trim();
  if (pref) {
    const sameProvider = options.find((row) => row.provider === pref);
    if (sameProvider) {
      return { provider: sameProvider.provider, model: sameProvider.model };
    }
  }
  const first = options[0];
  return { provider: first.provider, model: first.model };
}

/** Return a selectable provider/model pair, falling back when stale or missing. */
export function coerceSelectableModel(
  providers: Record<string, ProviderCatalogEntry>,
  provider: string,
  model: string,
  preferredProvider?: string,
): { provider: string; model: string } | null {
  const providerId = provider.trim();
  const bare = normalizeBareModelId(model);
  if (providerId && bare && isModelSelectable(providerId, bare, providers)) {
    const canonical =
      canonicalizeCatalogModel(providerId, bare, providers) ?? bare;
    return { provider: providerId, model: canonical };
  }
  return resolveFallbackModel(providers, preferredProvider || providerId);
}

export type PaneModelLike = {
  id: string;
  modelProvider?: string;
  modelName?: string;
};

export type ReconcilePaneModelsResult = {
  panes: PaneModelLike[];
  activeProvider: string;
  activeModel: string;
  changedPaneIds: string[];
  activeChanged: boolean;
};

/** Drop or migrate pane/global models that are no longer in the visible catalog. */
export function reconcilePaneModelsWithSettings(input: {
  panes: PaneModelLike[];
  activePaneId: string;
  activeProvider: string;
  activeModel: string;
  providers: Record<string, ProviderCatalogEntry>;
}): ReconcilePaneModelsResult {
  const providers = normalizeAllProviders(input.providers);
  const changedPaneIds: string[] = [];
  const nextPanes = input.panes.map((pane) => {
    const provider = (pane.modelProvider ?? "").trim();
    const model = (pane.modelName ?? "").trim();
    if (!provider && !model) return pane;
    const coerced = coerceSelectableModel(providers, provider, model, provider);
    if (!coerced) {
      if (provider || model) changedPaneIds.push(pane.id);
      return { ...pane, modelProvider: "", modelName: "" };
    }
    if (coerced.provider === provider && coerced.model === model) return pane;
    changedPaneIds.push(pane.id);
    return { ...pane, modelProvider: coerced.provider, modelName: coerced.model };
  });

  const activePane = nextPanes.find((p) => p.id === input.activePaneId) ?? nextPanes[0];
  let nextActiveProvider = (input.activeProvider ?? "").trim();
  let nextActiveModel = (input.activeModel ?? "").trim();
  let activeChanged = false;

  const activeFromPane = coerceSelectableModel(
    providers,
    String(activePane?.modelProvider ?? ""),
    String(activePane?.modelName ?? ""),
    nextActiveProvider,
  );
  if (activeFromPane) {
    if (
      activeFromPane.provider !== nextActiveProvider ||
      activeFromPane.model !== nextActiveModel
    ) {
      activeChanged = true;
    }
    nextActiveProvider = activeFromPane.provider;
    nextActiveModel = activeFromPane.model;
  } else {
    const coercedActive = coerceSelectableModel(
      providers,
      nextActiveProvider,
      nextActiveModel,
      nextActiveProvider,
    );
    if (!coercedActive) {
      if (nextActiveProvider || nextActiveModel) activeChanged = true;
      nextActiveProvider = "";
      nextActiveModel = "";
    } else if (
      coercedActive.provider !== nextActiveProvider ||
      coercedActive.model !== nextActiveModel
    ) {
      activeChanged = true;
      nextActiveProvider = coercedActive.provider;
      nextActiveModel = coercedActive.model;
    }
  }

  return {
    panes: nextPanes,
    activeProvider: nextActiveProvider,
    activeModel: nextActiveModel,
    changedPaneIds,
    activeChanged,
  };
}
