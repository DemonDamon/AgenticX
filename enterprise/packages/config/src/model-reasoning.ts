/**
 * How a model exposes its reasoning, as deployment data rather than as code.
 *
 * Nearly every reasoning decision in the product can be made from the output
 * that actually arrived: an OpenAI-compatible stream whose `content` carries a
 * `</think>` with no opening tag has proved that its template prefilled the
 * block, whatever the model is called. A private deployment can rename models,
 * so those paths ask the output, never this table.
 *
 * Only request shaping has to decide before any output exists — a planner call
 * must already carry the switch that keeps a short JSON answer out of a long
 * reasoning trace. That one decision consults the lists below, and a deployment
 * can name its own models without a rebuild. When a model contradicts the list
 * at runtime, the normalizer recovers the answer and names the model in the log
 * rather than degrading in silence.
 */

/** vLLM templates that prefill `<think>` outside the generated token stream. */
const DEFAULT_THINK_PREFILL_MODELS = ["qwen3.8"];
/** Endpoints that take a top-level `enable_thinking` switch. */
const DEFAULT_THINKING_TOGGLE_MODELS = ["glm5.2"];

export const THINK_PREFILL_MODELS_ENV = "AGENTICX_THINK_PREFILL_MODELS";
export const THINKING_TOGGLE_MODELS_ENV = "AGENTICX_THINKING_TOGGLE_MODELS";

export type ModelReasoningEnv = Record<string, string | undefined>;

function ambientEnv(): ModelReasoningEnv {
  // The package is imported by client components too. Read the process table
  // lazily and tolerate its absence instead of throwing inside a bundle.
  return typeof process === "undefined" ? {} : (process.env ?? {});
}

/** Accept a comma, semicolon or whitespace separated list from one variable. */
export function parseModelFamilyList(raw: unknown): string[] {
  return String(raw ?? "")
    .split(/[,;\s]+/)
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
}

function configuredFamilies(
  variable: string,
  fallback: readonly string[],
  env: ModelReasoningEnv,
): readonly string[] {
  const configured = parseModelFamilyList(env[variable]);
  return configured.length > 0 ? configured : fallback;
}

/** The id a gateway reports may be `tenant/vendor/model`; only the leaf names it. */
export function modelFamilySlug(model: unknown): string {
  const text = String(model ?? "").trim().toLowerCase();
  if (!text) return "";
  return text.split("/").at(-1) ?? "";
}

/**
 * Build the matcher for one configured family.
 *
 * Vendors punctuate the same family inconsistently (`glm5.2`, `glm-5.2`,
 * `glm_5.2`), and an operator typing a deployment's model name should not have
 * to guess which one this file wants, so the separator between a name and its
 * version is optional on both sides. The trailing boundary keeps a family from
 * swallowing its successor: `qwen3.8` matches `qwen3.8-27b` but not `qwen3.81`.
 */
function familyMatcher(family: string): RegExp {
  const flexible = family
    .split(/[\s_-]+/)
    .filter(Boolean)
    // A configured entry is a model name, never a pattern: an operator who
    // writes `glm.*` must not match every GLM ever published.
    .map((segment) => segment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .map((segment) =>
      segment.replace(/([a-z])(?=[0-9])/g, "$1[-_]?").replace(/([0-9])(?=[a-z])/g, "$1[-_]?"),
    )
    .join("[-_]?");
  if (!flexible) return /(?!)/;
  return new RegExp(`^${flexible}(?:$|[-_.:@])`);
}

function matchesAnyFamily(model: unknown, families: readonly string[]): boolean {
  const slug = modelFamilySlug(model);
  if (!slug) return false;
  return families.some((family) => familyMatcher(family).test(slug));
}

/** The families this deployment treats as prefilling `<think>`, for diagnostics. */
export function thinkPrefillFamilies(env?: ModelReasoningEnv): readonly string[] {
  return configuredFamilies(
    THINK_PREFILL_MODELS_ENV,
    DEFAULT_THINK_PREFILL_MODELS,
    env ?? ambientEnv(),
  );
}

/** The families this deployment sends a top-level `enable_thinking` switch. */
export function thinkingToggleFamilies(env?: ModelReasoningEnv): readonly string[] {
  return configuredFamilies(
    THINKING_TOGGLE_MODELS_ENV,
    DEFAULT_THINKING_TOGGLE_MODELS,
    env ?? ambientEnv(),
  );
}

/**
 * True when the model's chat template opens `<think>` itself, so its reasoning
 * arrives inside `content` and only the closing boundary is generated.
 */
export function modelPrefillsThinkTag(model: unknown, env?: ModelReasoningEnv): boolean {
  return matchesAnyFamily(model, thinkPrefillFamilies(env));
}

/** True when the endpoint accepts a top-level `enable_thinking` request field. */
export function modelTakesThinkingToggle(model: unknown, env?: ModelReasoningEnv): boolean {
  return matchesAnyFamily(model, thinkingToggleFamilies(env));
}
