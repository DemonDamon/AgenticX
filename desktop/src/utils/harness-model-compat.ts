/**
 * Near composer model catalog × active coding-agent harness.
 *
 * Single shared catalog lives in Settings → providers (「配置模型」).
 * The composer picker greys or keeps models based on the pane/preferred
 * harness — it does not require re-entering the same ids into each CLI's
 * local config for them to appear here.
 *
 * Compatibility rule (keep in sync with PR / tests):
 * - builtin / python-agent: full selectable catalog (today).
 * - claude-code / codex / opencode / codebuddy: selectable chat/reasoning
 *   models stay available. Spawn `--model` / `-m` is an opaque string
 *   resolved by the CLI's own endpoint (BYOS); Near does not filter by
 *   provider API family, because Anthropic-compatible gateways commonly
 *   serve non-Anthropic ids. Embedding models are disabled.
 *   Ollama-native providers are disabled for claude-code, codex, and
 *   codebuddy (those CLIs do not speak Ollama's native API — CodeBuddy
 *   routes through its own cloud/catalog model ids via `--model`);
 *   opencode still allows them.
 * - unknown external: no native model spawn option → all disabled with a
 *   short reason (adapters reject unknown options).
 */

import { isEmbeddingModelKind, inferModelKind } from "./model-capability";
import {
  CLAUDE_LIVE_SETTINGS_PROVIDER_ID,
  collectSelectableModelOptions,
  isClaudeLiveSettingsProvider,
  isModelSelectable,
  type ProviderCatalogEntry,
  type SelectableModelOption,
} from "./model-options";
import { isOllamaLikeProvider } from "./provider-display";
import {
  BUILTIN_HARNESS_ID,
  normalizePreferredHarnessId,
} from "./preferred-harness";

/** Mirrors agenticx.studio.harness_wiring._HARNESSES_WITH_MODEL_OPTION. */
export const HARNESSES_WITH_NATIVE_MODEL_OPTION: ReadonlySet<string> = new Set([
  "claude-code",
  "codex",
  "opencode",
  "codebuddy",
]);

export type HarnessModelDisableReason =
  | "harness_no_model_option"
  | "embedding_unsupported"
  | "ollama_unsupported";

export type HarnessModelAvailability = {
  available: boolean;
  reason?: HarnessModelDisableReason;
};

/**
 * Pane harness wins. ``null`` / empty means builtin (snapshotted at pane
 * create from preferred) — do not re-read the Settings preferred value, or
 * changing preferred would rewrite existing builtin panes.
 *
 * When ``paneHarnessId`` is ``undefined`` (key missing on a brand-new pane),
 * fall back to preferred so the picker matches the next-session default.
 */
export function resolveActiveHarnessId(
  paneHarnessId: string | null | undefined,
  preferredHarnessId: string | null | undefined,
): string {
  if (paneHarnessId === undefined) {
    return normalizePreferredHarnessId(preferredHarnessId);
  }
  return normalizePreferredHarnessId(paneHarnessId);
}

export function harnessSupportsNativeModelOption(harnessId: string): boolean {
  const id = normalizePreferredHarnessId(harnessId);
  if (id === BUILTIN_HARNESS_ID) return false;
  return HARNESSES_WITH_NATIVE_MODEL_OPTION.has(id);
}

export function isBuiltinHarnessId(harnessId: string | null | undefined): boolean {
  return normalizePreferredHarnessId(harnessId) === BUILTIN_HARNESS_ID;
}

/**
 * Whether a catalog provider/model may be chosen for the given harness.
 * Non-selectable catalog pairs are reported unavailable.
 */
export function evaluateModelForHarness(
  harnessId: string | null | undefined,
  providerId: string,
  modelId: string,
  providers: Record<string, ProviderCatalogEntry>,
): HarnessModelAvailability {
  const hid = normalizePreferredHarnessId(harnessId);
  if (isClaudeLiveSettingsProvider(providerId)) {
    if (hid === "claude-code" && String(modelId || "").trim()) {
      return { available: true };
    }
    return { available: false, reason: "harness_no_model_option" };
  }
  if (!isModelSelectable(providerId, modelId, providers)) {
    return { available: false, reason: "harness_no_model_option" };
  }
  if (hid === BUILTIN_HARNESS_ID) {
    return { available: true };
  }
  if (!HARNESSES_WITH_NATIVE_MODEL_OPTION.has(hid)) {
    return { available: false, reason: "harness_no_model_option" };
  }
  const kind = inferModelKind(providerId, modelId).kind;
  if (isEmbeddingModelKind(kind)) {
    return { available: false, reason: "embedding_unsupported" };
  }
  const entry = providers[providerId];
  if (
    (hid === "claude-code" || hid === "codex" || hid === "codebuddy")
    && isOllamaLikeProvider(providerId, entry)
  ) {
    return { available: false, reason: "ollama_unsupported" };
  }
  return { available: true };
}

export function isModelAvailableForHarness(
  harnessId: string | null | undefined,
  providerId: string,
  modelId: string,
  providers: Record<string, ProviderCatalogEntry>,
): boolean {
  return evaluateModelForHarness(harnessId, providerId, modelId, providers).available;
}

export type HarnessModelOption = SelectableModelOption & {
  available: boolean;
  reason?: HarnessModelDisableReason;
};

/** Full catalog with per-row availability for the active harness. */
export function collectHarnessModelOptions(
  providers: Record<string, ProviderCatalogEntry>,
  harnessId: string | null | undefined,
  separator = "/",
): HarnessModelOption[] {
  return collectSelectableModelOptions(providers, separator).map((row) => {
    const verdict = evaluateModelForHarness(
      harnessId,
      row.provider,
      row.model,
      providers,
    );
    return {
      ...row,
      available: verdict.available,
      reason: verdict.reason,
    };
  });
}

export function resolveFallbackModelForHarness(
  providers: Record<string, ProviderCatalogEntry>,
  harnessId: string | null | undefined,
  preferredProvider?: string,
): { provider: string; model: string } | null {
  const options = collectHarnessModelOptions(providers, harnessId);
  const available = options.filter((row) => row.available);
  if (available.length === 0) return null;
  const pref = (preferredProvider ?? "").trim();
  if (pref) {
    const same = available.find((row) => row.provider === pref);
    if (same) return { provider: same.provider, model: same.model };
  }
  const first = available[0];
  return { provider: first.provider, model: first.model };
}

/** Keep current selection when valid for harness; otherwise fall back. */
export function coerceModelForHarness(
  providers: Record<string, ProviderCatalogEntry>,
  harnessId: string | null | undefined,
  provider: string,
  model: string,
  preferredProvider?: string,
): { provider: string; model: string } | null {
  const providerId = provider.trim();
  const modelId = model.trim();
  if (
    providerId
    && modelId
    && isModelAvailableForHarness(harnessId, providerId, modelId, providers)
  ) {
    return { provider: providerId, model: modelId };
  }
  return resolveFallbackModelForHarness(
    providers,
    harnessId,
    preferredProvider || providerId,
  );
}

/** Build synthetic picker rows for opaque ids from live Claude settings. */
export function collectClaudeLiveSettingsModelOptions(
  liveModelIds: readonly string[],
  separator = "/",
): HarnessModelOption[] {
  const seen = new Set<string>();
  const rows: HarnessModelOption[] = [];
  for (const raw of liveModelIds) {
    const model = String(raw || "").trim();
    if (!model || seen.has(model)) continue;
    seen.add(model);
    rows.push({
      provider: CLAUDE_LIVE_SETTINGS_PROVIDER_ID,
      model,
      label: `${CLAUDE_LIVE_SETTINGS_PROVIDER_ID}${separator}${model}`,
      available: true,
    });
  }
  return rows;
}

/**
 * Under ``claude-code``, append live settings aliases that are not already
 * present as a catalog (provider, model) pair. Other harnesses unchanged.
 */
export function enrichHarnessModelOptionsWithClaudeLive(
  options: readonly HarnessModelOption[],
  harnessId: string | null | undefined,
  liveModelIds: readonly string[],
  separator = "/",
): HarnessModelOption[] {
  const hid = normalizePreferredHarnessId(harnessId);
  if (hid !== "claude-code") return [...options];
  const existingModels = new Set(
    options.map((row) => String(row.model || "").trim()).filter(Boolean),
  );
  const extras = collectClaudeLiveSettingsModelOptions(liveModelIds, separator).filter(
    (row) => !existingModels.has(row.model),
  );
  if (extras.length === 0) return [...options];
  return [...options, ...extras];
}

export { CLAUDE_LIVE_SETTINGS_PROVIDER_ID, isClaudeLiveSettingsProvider };

