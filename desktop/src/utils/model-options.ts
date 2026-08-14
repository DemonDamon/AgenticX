import { formatModelOptionLabel, normalizeBareModelId } from "./model-display";

export type ProviderCatalogEntry = {
  apiKey: string;
  baseUrl: string;
  model: string;
  models: string[];
  enabled: boolean;
  dropParams: boolean;
  displayName?: string;
  interface?: "openai" | "ollama";
  managed?: boolean;
};

export type SelectableModelOption = {
  provider: string;
  model: string;
  label: string;
};

const MODEL_PREFIX_COLLATOR = new Intl.Collator("en-US", {
  numeric: true,
  sensitivity: "base",
});

function modelPrefixSortKey(modelId: string): string {
  const segments = modelId
    .trim()
    .toLowerCase()
    .split("/")
    .map((segment) => segment.trim())
    .filter(Boolean);
  if (segments.length > 1) return segments.slice(0, -1).join("/");
  const bare = segments[0] ?? "";
  return bare.match(/^[a-z]+/)?.[0] ?? bare;
}

/** Keep models with the same routing/family prefix adjacent, then sort naturally within it. */
export function sortModelOptionsByPrefix<T extends Pick<SelectableModelOption, "model">>(
  options: readonly T[],
): T[] {
  return [...options].sort((left, right) => {
    const prefixOrder = MODEL_PREFIX_COLLATOR.compare(
      modelPrefixSortKey(left.model),
      modelPrefixSortKey(right.model),
    );
    if (prefixOrder !== 0) return prefixOrder;
    return MODEL_PREFIX_COLLATOR.compare(left.model, right.model);
  });
}

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

/** At least apiKey or custom baseUrl — aligns with SettingsPanel providerCredentialed. */
export function isProviderCredentialed(
  entry: Pick<ProviderCatalogEntry, "apiKey" | "baseUrl"> | undefined,
): boolean {
  if (!entry) return false;
  return Boolean((entry.apiKey ?? "").trim() || (entry.baseUrl ?? "").trim());
}

function providerPassesPickerGate(entry: ProviderCatalogEntry): boolean {
  if (entry.enabled === false) return false;
  return isProviderCredentialed(entry);
}

export function isModelInProviderCatalog(
  providerId: string,
  modelId: string,
  providers: Record<string, ProviderCatalogEntry>,
): boolean {
  const entry = providers[providerId];
  if (!entry || entry.enabled === false) return false;
  return canonicalizeCatalogModel(providerId, modelId, providers) !== null;
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
  const raw = modelId.trim();
  if (!raw) return null;
  const candidates = listProviderVisibleModelIds(entry);
  // Managed Enterprise ids can contain several routing segments, for example
  // `chinamobile/kimi/kimi-k3`. Prefer the exact catalog id before comparing a
  // single optional routing prefix; repeatedly stripping prefixes silently
  // turns a valid choice into a different model and falls back to row one.
  const exact = candidates.find((candidate) => candidate.trim() === raw);
  if (exact) return exact;
  const bare = normalizeBareModelId(raw);
  const hit = candidates.find((candidate) => {
    const candidateBare = normalizeBareModelId(candidate);
    return candidateBare === raw || candidateBare === bare;
  });
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

/**
 * Skip the provider level only when the complete visible picker catalog is a
 * single managed provider. A normal single-provider setup keeps the hierarchy
 * so adding more providers later does not change the interaction model.
 */
export function resolveDirectModelPickerProvider(
  providers: Record<string, ProviderCatalogEntry>,
): string | null {
  const selectableProviders = Object.entries(providers).filter(([, entry]) =>
    providerPassesPickerGate(entry),
  );
  if (selectableProviders.length !== 1) return null;
  const [providerId, entry] = selectableProviders[0] ?? [];
  return providerId && entry?.managed === true ? providerId : null;
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
  const requestedModel = model.trim();
  if (providerId && requestedModel && isModelSelectable(providerId, requestedModel, providers)) {
    const canonical =
      canonicalizeCatalogModel(providerId, requestedModel, providers) ?? requestedModel;
    return { provider: providerId, model: canonical };
  }
  return resolveFallbackModel(providers, preferredProvider || providerId);
}

export type SessionBindingModelInput = {
  providers: Record<string, ProviderCatalogEntry>;
  /** True when the caller queried session metadata, even if it found no model. */
  sessionModelKnown: boolean;
  sessionProvider?: string;
  sessionModel?: string;
  paneProvider?: string;
  paneModel?: string;
  avatarProvider?: string;
  avatarModel?: string;
  defaultProvider?: string;
  defaultModel?: string;
  activeProvider?: string;
  activeModel?: string;
};

/** Resolve a pane model without mistaking an inherited layout snapshot for a session override. */
export function resolveSessionBindingModel(
  input: SessionBindingModelInput,
): { provider: string; model: string } | null {
  const candidates: Array<[string | undefined, string | undefined]> = [
    [input.sessionProvider, input.sessionModel],
    ...(input.sessionModelKnown ? [] : [[input.paneProvider, input.paneModel] as const]),
    [input.avatarProvider, input.avatarModel],
    [input.defaultProvider, input.defaultModel],
    [input.activeProvider, input.activeModel],
  ];
  for (const [rawProvider, rawModel] of candidates) {
    const provider = String(rawProvider ?? "").trim();
    const model = String(rawModel ?? "").trim();
    if (!provider || !model) continue;
    const resolved = coerceSelectableModel(input.providers, provider, model, provider);
    if (resolved) return resolved;
  }
  return resolveFallbackModel(input.providers, input.defaultProvider || input.activeProvider);
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
