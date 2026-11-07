/**
 * Per-turn harness labels for chat UI badges.
 *
 * Builtin / python-agent → AgenticX (Damon rename from 内置 Runtime).
 * External harnesses use catalog-friendly display names.
 */

import { BUILTIN_HARNESS_ID, normalizePreferredHarnessId } from "./preferred-harness";

export type HarnessDisplayKind = "agenticx" | "claude-code" | "codebuddy" | "other";

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
  return normalizePreferredHarnessId(trimmed);
}

export function harnessDisplayKind(harnessId: string | null | undefined): HarnessDisplayKind {
  const id = normalizePreferredHarnessId(harnessId);
  if (id === BUILTIN_HARNESS_ID || !id) return "agenticx";
  if (id === "claude-code") return "claude-code";
  if (id === "codebuddy") return "codebuddy";
  return "other";
}

/** Stable i18n key under chat:harness.* for known harnesses. */
export function harnessBadgeI18nKey(harnessId: string | null | undefined): string {
  const kind = harnessDisplayKind(harnessId);
  if (kind === "agenticx") return "harness.badgeAgenticX";
  if (kind === "claude-code") return "harness.badgeClaudeCode";
  if (kind === "codebuddy") return "harness.badgeCodeBuddy";
  return "harness.badgeOther";
}

export function harnessBadgeFallbackLabel(harnessId: string | null | undefined): string {
  const id = normalizePreferredHarnessId(harnessId);
  if (id === BUILTIN_HARNESS_ID || !id) return "AgenticX";
  if (id === "claude-code") return "Claude Code";
  if (id === "codebuddy") return "CodeBuddy";
  return id;
}
