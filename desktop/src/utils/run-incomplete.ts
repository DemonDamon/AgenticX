/**
 * Run-level "ended incomplete" detection for artifact badging (P1.3).
 *
 * A run ends incomplete when it died from token-budget exhaustion or
 * rounds exhaustion (event notice), or when its final assistant reply was
 * produced in the last allowed round under round pressure (silent
 * half-product marker written by the runtime into message metadata).
 *
 * Author: Damon Li
 */

import type { Message } from "../store";

export type RunIncompleteKind = "token_budget" | "rounds_exhausted" | "rounds_final";

export type RunIncomplete = {
  kind: RunIncompleteKind;
};

/** Read the last-round truncation marker persisted on an assistant message. */
export function readRoundsExhaustedMeta(
  message: Message,
): { round: number; maxRounds: number } | null {
  if (message.role !== "assistant") return null;
  const metadata = message.metadata;
  if (!metadata || metadata.rounds_exhausted !== true) return null;
  const round = Number(metadata.round);
  const maxRounds = Number(metadata.max_rounds);
  return {
    round: Number.isFinite(round) && round > 0 ? round : maxRounds || 0,
    maxRounds: Number.isFinite(maxRounds) && maxRounds > 0 ? maxRounds : round || 0,
  };
}

/**
 * Whether the session's latest work ended incomplete (token/rounds death or
 * last-round truncation). Scans from the newest message backwards:
 *
 * - A truncation marker (budget/rounds notice, or a last-round final reply)
 *   that is not followed by any normally completed turn means the latest
 *   outputs are suspect → incomplete.
 * - A later turn that concluded normally (assistant FINAL, marked with
 *   metadata.turn_terminal) clears the flag: the continuation flow ("send a
 *   new message to resume with a fresh budget") finished the work, so its
 *   artifacts are no longer half-done.
 * - Interim assistant rows (turn_terminal false/absent, thinking-only) are
 *   not decisive; keep scanning.
 */
export function findRunIncompleteInMessages(messages: Message[]): RunIncomplete | null {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const msg = messages[i];
    if (msg.role === "assistant") {
      const meta = readRoundsExhaustedMeta(msg);
      if (meta) return { kind: "rounds_final" };
      const terminal = (msg.metadata as Record<string, unknown> | undefined)?.turn_terminal;
      if (terminal === true) return null;
    }
    if (msg.role === "tool") {
      if (msg.noticeKind === "budget_exceeded") return { kind: "token_budget" };
      if (msg.noticeKind === "rounds_exhausted") return { kind: "rounds_exhausted" };
      const text = String(msg.content ?? "");
      if (/Token budget exceeded/i.test(text)) return { kind: "token_budget" };
      if (text.includes("已达到最大工具调用轮数")) return { kind: "rounds_exhausted" };
    }
  }
  return null;
}
