/**
 * In-process waiters for deep-research clarify resume.
 * Multi-replica deployments need an external store (out of scope).
 */

export type ClarifyResumePayload = {
  answers: Record<string, string>;
  skip: boolean;
  timedOut?: boolean;
};

type Waiter = {
  resolve: (value: ClarifyResumePayload) => void;
  reject: (reason?: unknown) => void;
  timer: ReturnType<typeof setTimeout>;
};

const waiters = new Map<string, Waiter>();

export function waitForClarifyResume(
  runId: string,
  timeoutMs: number,
): Promise<ClarifyResumePayload> {
  const existing = waiters.get(runId);
  if (existing) {
    clearTimeout(existing.timer);
    existing.reject(new Error("clarify waiter replaced"));
    waiters.delete(runId);
  }

  return new Promise<ClarifyResumePayload>((resolve, reject) => {
    const timer = setTimeout(() => {
      waiters.delete(runId);
      resolve({ answers: {}, skip: true, timedOut: true });
    }, timeoutMs);
    waiters.set(runId, { resolve, reject, timer });
  });
}

export function resolveClarifyResume(runId: string, payload: ClarifyResumePayload): boolean {
  const waiter = waiters.get(runId);
  if (!waiter) return false;
  clearTimeout(waiter.timer);
  waiters.delete(runId);
  waiter.resolve(payload);
  return true;
}

export function hasClarifyWaiter(runId: string): boolean {
  return waiters.has(runId);
}

/** Test helper */
export function clearClarifyWaiters(): void {
  for (const waiter of waiters.values()) {
    clearTimeout(waiter.timer);
    waiter.reject(new Error("cleared"));
  }
  waiters.clear();
}
