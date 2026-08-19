import type { ProviderEntry } from "../store";

export type GlobalDefaultModelUpdate = {
  defaultProvider: string;
  providers: Record<string, ProviderEntry>;
};

/**
 * Apply a global provider/model choice to a persisted provider snapshot.
 *
 * SettingsPanel intentionally calls this with its last saved snapshot rather
 * than the live provider draft, so choosing a default model never commits
 * unrelated API key/catalog edits that are still waiting for the Provider
 * tab's explicit Save action.
 */
export function applyGlobalDefaultModelChoice(
  savedProviders: Record<string, ProviderEntry>,
  provider: string,
  model: string,
): GlobalDefaultModelUpdate | null {
  const providerId = String(provider ?? "").trim();
  const modelId = String(model ?? "").trim();
  const savedEntry = savedProviders[providerId];
  if (!providerId || !modelId || !savedEntry) return null;

  const configuredModels = Array.isArray(savedEntry.models) ? savedEntry.models : [];
  // Legacy/custom providers may persist only `model` and leave `models` empty;
  // the picker treats that single value as selectable, so saving must agree.
  const visibleModels = configuredModels.length > 0
    ? configuredModels
    : [savedEntry.model];
  if (!visibleModels.some((candidate) => String(candidate ?? "").trim() === modelId)) {
    return null;
  }

  return {
    defaultProvider: providerId,
    providers: {
      ...savedProviders,
      [providerId]: {
        ...savedEntry,
        model: modelId,
      },
    },
  };
}
