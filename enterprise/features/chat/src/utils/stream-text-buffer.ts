/** Bound rendering work without delaying SSE consumption or dropping text. */
export function createStreamTextBuffer(write: (text: string) => void, initialLength = 0) {
  let pending = "";
  let length = initialLength;
  let started = false;
  let stopped = false;
  let pendingError: { cause: unknown } | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  function checkError() {
    if (!pendingError) return;
    const { cause } = pendingError;
    pendingError = undefined;
    throw cause;
  }
  function flush() {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    checkError();
    if (stopped || !pending) return;
    const text = pending;
    pending = "";
    write(text);
  }
  return {
    push(text: string) {
      checkError();
      if (stopped || !text) return;
      pending += text;
      length += text.length;
      if (!started) {
        started = true;
        flush(); // Preserve time-to-first-visible-token.
      } else if (timer === undefined) {
        timer = setTimeout(() => {
          try { flush(); } catch (cause) {
            // Re-throw into the stream's normal catch/finalization path, not
            // as an unhandled timer exception that leaves the turn spinning.
            pendingError = { cause };
          }
        }, length >= 20_000 ? 160 : 80);
      }
    },
    flush,
    stop() {
      try { flush(); } finally { stopped = true; }
    },
  };
}
