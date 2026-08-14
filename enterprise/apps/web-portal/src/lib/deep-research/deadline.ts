/** Active-time deadline shared by every stage of one deep-research run. */

export const DEEP_RESEARCH_DEADLINE_MESSAGE = "deep research active-time deadline exceeded";

function deadlineReason(): DOMException {
  return new DOMException(DEEP_RESEARCH_DEADLINE_MESSAGE, "TimeoutError");
}

export class PausableDeadline {
  private readonly controller = new AbortController();
  private remaining: number;
  private activeSince: number;
  private paused = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private didExpire = false;

  constructor(
    totalMs: number,
    private readonly now: () => number = Date.now,
  ) {
    this.remaining = Math.max(1, Math.floor(totalMs));
    this.activeSince = this.now();
    this.arm();
  }

  get signal(): AbortSignal {
    return this.controller.signal;
  }

  get expired(): boolean {
    return this.didExpire;
  }

  remainingMs(): number {
    if (this.didExpire) return 0;
    const value = this.paused
      ? this.remaining
      : this.remaining - Math.max(0, this.now() - this.activeSince);
    if (value <= 0 && !this.paused) {
      this.expire();
      return 0;
    }
    return Math.max(0, value);
  }

  pause(): void {
    if (this.paused || this.controller.signal.aborted) return;
    const remaining = this.remainingMs();
    if (this.controller.signal.aborted) return;
    this.remaining = remaining;
    this.paused = true;
    this.clearTimer();
  }

  resume(): void {
    if (!this.paused || this.controller.signal.aborted) return;
    this.paused = false;
    this.activeSince = this.now();
    this.arm();
  }

  dispose(): void {
    this.clearTimer();
  }

  private arm(): void {
    this.clearTimer();
    const remaining = this.remainingMs();
    if (remaining <= 0 || this.paused || this.controller.signal.aborted) return;
    this.timer = setTimeout(() => this.expire(), Math.max(1, Math.ceil(remaining)));
  }

  private expire(): void {
    if (this.controller.signal.aborted) return;
    this.didExpire = true;
    this.remaining = 0;
    this.clearTimer();
    this.controller.abort(deadlineReason());
  }

  private clearTimer(): void {
    if (!this.timer) return;
    clearTimeout(this.timer);
    this.timer = null;
  }
}

export class GatewayStreamIdleTimeoutError extends Error {
  constructor(readonly timeoutMs: number) {
    super(`gateway stream produced no data for ${timeoutMs}ms`);
    this.name = "GatewayStreamIdleTimeoutError";
  }
}

/**
 * One abort-aware stream read with an idle ceiling. The caller invokes this for
 * every chunk, so receiving data naturally resets the idle timer.
 */
export async function readStreamWithIdleTimeout<T>(
  reader: ReadableStreamDefaultReader<T>,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<ReadableStreamReadResult<T>> {
  if (signal?.aborted) throw signal.reason ?? new DOMException("Aborted", "AbortError");

  let timer: ReturnType<typeof setTimeout> | null = null;
  let onAbort: (() => void) | null = null;
  const idle = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      const error = new GatewayStreamIdleTimeoutError(timeoutMs);
      // Settle the timeout first. cancel() resolves a pending read, so doing it
      // first would let the successful `{ done: true }` win Promise.race().
      reject(error);
      queueMicrotask(() => {
        void reader.cancel("gateway stream idle timeout").catch(() => undefined);
      });
    }, Math.max(1, timeoutMs));
  });
  const aborted = new Promise<never>((_resolve, reject) => {
    if (!signal) return;
    onAbort = () => {
      reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
      queueMicrotask(() => {
        void reader.cancel(signal.reason).catch(() => undefined);
      });
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });

  try {
    return await Promise.race([reader.read(), idle, aborted]);
  } finally {
    if (timer) clearTimeout(timer);
    if (signal && onAbort) signal.removeEventListener("abort", onAbort);
  }
}

export function isAbortLike(error: unknown): boolean {
  return (
    error instanceof DOMException &&
    (error.name === "AbortError" || error.name === "TimeoutError")
  );
}
