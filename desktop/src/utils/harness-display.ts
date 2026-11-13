/**
 * Per-turn harness labels + canonical ids for chat UI badges / pickers.
 *
 * Builtin / python-agent → AgenticX. External harnesses use catalog-friendly
 * display names. Alias map keeps metadata variants (pi / pi-agent, etc.)
 * resolving to one id so exclusive SVG marks stay consistent.
 */

import { BUILTIN_HARNESS_ID, normalizePreferredHarnessId } from "./preferred-harness";

/** Canonical harness ids that have exclusive brand marks or AgenticX. */
export type KnownHarnessId =
  | typeof BUILTIN_HARNESS_ID
  | "claude-code"
  | "codebuddy"
  | "codex"
  | "opencode"
  | "deepseek"
  | "hermes-agent"
  | "pi-agent"
  | "openclaw";

const ALIASES: Record<string, KnownHarnessId | string> = {
  "": BUILTIN_HARNESS_ID,
  builtin: BUILTIN_HARNESS_ID,
  "python-agent": BUILTIN_HARNESS_ID,
  agenticx: BUILTIN_HARNESS_ID,
  "claude-code": "claude-code",
  claudecode: "claude-code",
  codebuddy: "codebuddy",
  "code-buddy": "codebuddy",
  codex: "codex",
  opencode: "opencode",
  "open-code": "opencode",
  deepseek: "deepseek",
  "deepseek-harness": "deepseek",
  hermes: "hermes-agent",
  "hermes-agent": "hermes-agent",
  hermesagent: "hermes-agent",
  pi: "pi-agent",
  "pi-agent": "pi-agent",
  openclaw: "openclaw",
  "open-claw": "openclaw",
};

const FALLBACK_LABELS: Record<string, string> = {
  [BUILTIN_HARNESS_ID]: "AgenticX",
  "claude-code": "Claude Code",
  codebuddy: "CodeBuddy",
  codex: "Codex",
  opencode: "OpenCode",
  deepseek: "DeepSeek",
  "hermes-agent": "Hermes Agent",
  "pi-agent": "PI Agent",
  openclaw: "OpenClaw",
};

const I18N_KEYS: Record<string, string> = {
  [BUILTIN_HARNESS_ID]: "harness.badgeAgenticX",
  "claude-code": "harness.badgeClaudeCode",
  codebuddy: "harness.badgeCodeBuddy",
  codex: "harness.badgeCodex",
  opencode: "harness.badgeOpenCode",
  deepseek: "harness.badgeDeepSeek",
  "hermes-agent": "harness.badgeHermesAgent",
  "pi-agent": "harness.badgePiAgent",
  openclaw: "harness.badgeOpenClaw",
};

/** Normalize raw harness id / alias → canonical id (or trimmed raw). */
export function canonicalizeHarnessId(
  harnessId: string | null | undefined,
): string {
  const raw = String(harnessId ?? "").trim();
  const preferred = normalizePreferredHarnessId(raw);
  const key = preferred.toLowerCase();
  if (key in ALIASES) return String(ALIASES[key]);
  // Also try the un-normalized trim for aliases like hermesagent
  const rawKey = raw.toLowerCase().replace(/\s+/g, "-");
  if (rawKey in ALIASES) return String(ALIASES[rawKey]);
  return preferred || BUILTIN_HARNESS_ID;
}

/** Merge a known harness onto a user row. null means the builtin runtime. */
export function stampUserMessageHarnessMetadata(
  metadata: Record<string, unknown> | undefined | null,
  harnessId: string | null,
): Record<string, unknown> {
  const canonical = canonicalizeHarnessId(harnessId);
  const base =
    metadata && typeof metadata === "object" ? { ...metadata } : {};
  return {
    ...base,
    harness: canonical,
    harness_id: canonical,
  };
}

export function resolveMessageHarnessId(
  metadata: Record<string, unknown> | undefined | null,
): string | null {
  if (!metadata || typeof metadata !== "object") return null;
  const raw =
    metadata.harness ??
    metadata.harness_id ??
    metadata.harnessId ??
    null;
  const trimmed = String(raw ?? "").trim();
  if (!trimmed) return null;
  return canonicalizeHarnessId(trimmed);
}

/** @deprecated Prefer canonicalizeHarnessId; kept for older call sites. */
export type HarnessDisplayKind =
  | "agenticx"
  | "claude-code"
  | "codebuddy"
  | "codex"
  | "opencode"
  | "deepseek"
  | "hermes-agent"
  | "pi-agent"
  | "openclaw"
  | "other";

export function harnessDisplayKind(harnessId: string | null | undefined): HarnessDisplayKind {
  const id = canonicalizeHarnessId(harnessId);
  if (id === BUILTIN_HARNESS_ID) return "agenticx";
  if (
    id === "claude-code" ||
    id === "codebuddy" ||
    id === "codex" ||
    id === "opencode" ||
    id === "deepseek" ||
    id === "hermes-agent" ||
    id === "pi-agent" ||
    id === "openclaw"
  ) {
    return id;
  }
  return "other";
}

/** Stable i18n key under chat:harness.* for known harnesses. */
export function harnessBadgeI18nKey(harnessId: string | null | undefined): string {
  const id = canonicalizeHarnessId(harnessId);
  return I18N_KEYS[id] ?? "harness.badgeOther";
}

export function harnessBadgeFallbackLabel(harnessId: string | null | undefined): string {
  const id = canonicalizeHarnessId(harnessId);
  return FALLBACK_LABELS[id] ?? id;
}

export function knownHarnessFallbackLabels(): Record<string, string> {
  return { ...FALLBACK_LABELS };
}
