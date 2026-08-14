export const DEFAULT_MODEL_PREFERENCE_KEY = "agx-enterprise-default-model";

type AvailableModel = {
  id: string;
  isDefault?: boolean;
};

export function resolveAvailableDefaultModel<T extends AvailableModel>(
  models: readonly T[],
  preferredModel: string | null | undefined,
  activeModel: string | null | undefined,
): T | undefined {
  const preferred = preferredModel?.trim();
  if (preferred) {
    const match = models.find((model) => model.id === preferred);
    if (match) return match;
  }

  const active = activeModel?.trim();
  if (active) {
    const match = models.find((model) => model.id === active);
    if (match) return match;
  }

  return models.find((model) => model.isDefault) ?? models[0];
}
export function readDefaultModelPreference(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(DEFAULT_MODEL_PREFERENCE_KEY)?.trim() || null;
  } catch {
    return null;
  }
}

export function writeDefaultModelPreference(modelId: string): void {
  if (typeof window === "undefined") return;
  const normalized = modelId.trim();
  if (!normalized) return;
  try {
    window.localStorage.setItem(DEFAULT_MODEL_PREFERENCE_KEY, normalized);
  } catch {
    // Storage can be unavailable in hardened browser contexts; the active
    // session model remains the in-memory fallback.
  }
}
