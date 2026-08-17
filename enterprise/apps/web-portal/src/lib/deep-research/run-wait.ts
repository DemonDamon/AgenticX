/**
 * Clarify resume coordination for deep-research.
 *
 * The run row is the single source of truth: the instance running the SSE turn
 * polls `getClarificationResume()`, while the instance serving `/resume` writes
 * the answer with a conditional UPDATE. The in-memory notifier below is a pure
 * latency optimisation for the common single-instance case — dropping it (HMR,
 * a different isolate, a different pod) only costs one poll interval.
 */

import {
  clarifyTimeoutPayload,
  type ClarifyResumePayload,
  type RunStore,
} from "./run-store";

export type { ClarifyResumePayload };

/** DB poll cadence while a clarify card is on screen. */
export const CLARIFY_POLL_INTERVAL_MS = 1_000;

type ClarifyGlobal = typeof globalThis & {
  __agxClarifyNotifiers?: Map<string, Set<() => void>>;
};

function notifiers(): Map<string, Set<() => void>> {
  const g = globalThis as ClarifyGlobal;
  if (!g.__agxClarifyNotifiers) g.__agxClarifyNotifiers = new Map();
  return g.__agxClarifyNotifiers;
}

/** Best-effort local ownership signal used before taking over an orphaned plan gate. */
export function hasLiveClarifyWaiter(runId: string): boolean {
  return (notifiers().get(runId)?.size ?? 0) > 0;
}

/** Wake local waiters immediately after a resume landed in the database. */
export function notifyClarifyResume(runId: string): void {
  const listeners = notifiers().get(runId);
  if (!listeners) return;
  for (const listener of [...listeners]) {
    try {
      listener();
    } catch {
      // A dead waiter must not block the others.
    }
  }
}

function subscribe(runId: string, listener: () => void): () => void {
  const map = notifiers();
  const listeners = map.get(runId) ?? new Set<() => void>();
  listeners.add(listener);
  map.set(runId, listeners);
  return () => {
    const current = map.get(runId);
    if (!current) return;
    current.delete(listener);
    if (current.size === 0) map.delete(runId);
  };
}

/**
 * Resolve once the run row carries a clarify answer, or once `timeoutMs` elapses
 * and `expireClarification()` wrote the skip payload. Never rejects: a database
 * hiccup degrades to "keep polling", and an unreachable database at the deadline
 * degrades to the timeout payload so the run still continues.
 */
export function waitForClarifyResume(
  runStore: RunStore,
  runId: string,
  timeoutMs: number,
): Promise<ClarifyResumePayload> {
  return new Promise<ClarifyResumePayload>((resolve) => {
    let settled = false;
    let unsubscribe: (() => void) | null = null;
    let poll: ReturnType<typeof setInterval> | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const settle = (payload: ClarifyResumePayload) => {
      if (settled) return;
      settled = true;
      if (poll !== null) clearInterval(poll);
      if (timer !== null) clearTimeout(timer);
      unsubscribe?.();
      resolve(payload);
    };

    const check = async () => {
      if (settled) return;
      try {
        const payload = await runStore.getClarificationResume(runId);
        if (payload) settle(payload);
      } catch {
        // Transient read failure — the next tick retries.
      }
    };

    poll = setInterval(() => {
      void check();
    }, CLARIFY_POLL_INTERVAL_MS);

    // timeoutMs <= 0 is an explicit indefinite plan-alignment gate.
    if (timeoutMs > 0) {
      timer = setTimeout(() => {
        void (async () => {
          if (settled) return;
          try {
            settle(await runStore.expireClarification(runId, new Date()));
          } catch {
            settle(clarifyTimeoutPayload());
          }
        })();
      }, timeoutMs);
    }

    unsubscribe = subscribe(runId, () => {
      void check();
    });
    void check();
  });
}
