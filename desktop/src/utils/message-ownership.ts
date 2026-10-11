import { dedupeSupervisorNotices } from "./supervisor-notice";
import { dedupeContinuationNotices } from "./continuation-notice";

/**
 * Cross-session message ownership invariant.
 *
 * Root cause of the recurring "session A's content shows in session B" bug:
 * `pane.messages` was keyed only by the UI slot (`paneId`), so a message had no
 * record of which session it belonged to. Every guard against cross-session
 * leakage was an ad-hoc `latestSid === sid` check scattered across call sites —
 * miss one path and a foreign message renders under the wrong session.
 *
 * The structural fix: every message carries `ownerSessionId`, and the render
 * layer only shows messages whose owner matches the pane's current session.
 * Even if a stray write lands in `pane.messages` while the pane shows another
 * session, it can never be displayed there.
 */

/** A message-like object that may carry its owning session id. */
export interface OwnedMessage {
  ownerSessionId?: string;
  role?: string;
  systemNotice?: unknown;
}

/**
 * Whether *msg* may render while the pane is showing *sessionId*.
 *
 * When the pane is bound to a real session, only rows stamped with that
 * `ownerSessionId` render. Untagged rows are hidden — callers must stamp via
 * `setPaneMessages` / `addPaneMessage` extras before display.
 *
 * Important for "全新对话" lazy mode: when the pane has no bound session
 * (`""`), only show rows that are also unbound. This prevents any late async
 * write from the previous real session from bleeding into the fresh composer.
 */
export function messageBelongsToSession(
  msg: OwnedMessage,
  sessionId: string | undefined | null,
): boolean {
  const sid = String(sessionId ?? "").trim();
  if (!sid) {
    const ownerWhenUnbound = String(msg.ownerSessionId ?? "").trim();
    return ownerWhenUnbound.length === 0;
  }
  const owner = String(msg.ownerSessionId ?? "").trim();
  if (!owner) {
    // Composer echoes can land before extras.ownerSessionId is stamped, or a
    // later merge can strip it. Hiding every untagged row made the just-sent
    // query vanish until a disk reload restamped ownerSessionId. Untagged
    // assistants/tools stay hidden — those are the cross-session leak vector.
    return String(msg.role ?? "") === "user";
  }
  return owner === sid;
}

function clientTurnIdOf(message: { metadata?: Record<string, unknown> }): string {
  return String(message.metadata?.client_turn_id ?? "").trim();
}

/**
 * Collapse back-to-back duplicate user messages that share the same trimmed
 * content. These can appear transiently when an optimistic write races with a
 * disk-reload path that both land in pane.messages before reconciliation runs.
 * Keeping only the last occurrence preserves any richer metadata (attachments,
 * ownerSessionId) that the disk copy may carry while dropping the bare
 * optimistic duplicate.
 *
 * Distinct `client_turn_id`s are real turns (same sentence sent again) and
 * must not be collapsed — otherwise the later query looks lost.
 */
function dedupeConsecutiveUserMessages<
  T extends { role: string; content?: unknown; metadata?: Record<string, unknown> },
>(messages: T[]): T[] {
  const out: T[] = [];
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    const next = messages[i + 1];
    const sameText =
      m.role === "user" &&
      next?.role === "user" &&
      String(m.content ?? "").trim().length > 0 &&
      String(m.content ?? "").trim() === String(next.content ?? "").trim();
    const distinctTurns = Boolean(
      sameText &&
        clientTurnIdOf(m) &&
        clientTurnIdOf(next) &&
        clientTurnIdOf(m) !== clientTurnIdOf(next),
    );
    if (sameText && !distinctTurns) {
      continue;
    }
    out.push(m);
  }
  return out;
}

/**
 * Filter a message list down to those that belong to *sessionId*.
 * Pure; preserves order; never mutates the input.
 */
export function visibleMessagesForSession<T extends OwnedMessage>(
  messages: readonly T[],
  sessionId: string | undefined | null,
): T[] {
  const filtered = messages.filter((m) => messageBelongsToSession(m, sessionId));
  const deduped = dedupeConsecutiveUserMessages(filtered as (T & { role: string; content?: unknown })[]);
  return dedupeContinuationNotices(dedupeSupervisorNotices(deduped)) as T[];
}

/**
 * Last index of *role* owned by *ownerSessionId*.
 *
 * Used by in-place stream patches (`mergeLastPaneMessageByRole`,
 * `updateLastPaneMessage`). Those helpers used to walk from the end of
 * `pane.messages` with no owner check, so a late SSE frame from session A
 * could overwrite session B's last assistant after the user switched
 * conversations in the same pane.
 *
 * Untagged rows are skipped when a real session is requested — they are the
 * historical leak vector. Empty owner returns -1 so callers cannot "default"
 * to the pane tail.
 */
export function findLastOwnedMessageIndex<T extends OwnedMessage>(
  messages: readonly T[],
  role: string,
  ownerSessionId: string | undefined | null,
): number {
  const owner = String(ownerSessionId ?? "").trim();
  if (!owner) return -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    const row = messages[i];
    if (row.role !== role || row.systemNotice) continue;
    if (String(row.ownerSessionId ?? "").trim() !== owner) continue;
    return i;
  }
  return -1;
}
