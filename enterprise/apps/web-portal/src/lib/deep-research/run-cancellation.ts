import type { RunStore } from "./run-store";

/** Durable status is authoritative, including when stop lands on another replica. */
export function watchRunCancellation(
  store: RunStore,
  owner: { tenantId: string; userId: string; runId: string },
  onAbort?: (reason: unknown) => void,
  intervalMs = 1_000,
) {
  const controller = new AbortController();
  let disposed = false;
  let checking = false;
  const check = async () => {
    if (disposed || checking || controller.signal.aborted) return;
    checking = true;
    try {
      const run = await store.get(owner.tenantId, owner.userId, owner.runId);
      if (!disposed && run?.status === "cancelled") {
        const reason = new DOMException("Research cancelled by user", "AbortError");
        controller.abort(reason);
        onAbort?.(reason);
      }
    } catch {
      // A transient read failure is not permission to fabricate a cancellation.
    } finally {
      checking = false;
    }
  };
  const timer = setInterval(() => void check(), intervalMs);
  void check();
  return {
    signal: controller.signal,
    dispose() { disposed = true; clearInterval(timer); },
  };
}
