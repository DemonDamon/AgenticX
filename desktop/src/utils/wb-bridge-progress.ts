/** Poll Studio's WB describe proxy while a send turn is in flight.

Author: Damon Li
*/

const polls = new Map<string, ReturnType<typeof setInterval>>();

export function startWbBridgeProgressPoll(opts: {
  key: string;
  sessionId: string;
  apiBase: string;
  apiToken: string;
  onSnapshot: (snap: Record<string, unknown>) => void;
}): void {
  stopWbBridgeProgressPoll(opts.key);
  const tick = async () => {
    try {
      const resp = await fetch(`${opts.apiBase}/api/wb-bridge/sessions/${opts.sessionId}`, {
        headers: { "x-agx-desktop-token": opts.apiToken },
      });
      if (!resp.ok) return;
      const snap = (await resp.json()) as Record<string, unknown>;
      opts.onSnapshot(snap);
    } catch {
      // Transient network errors: keep polling until stop.
    }
  };
  void tick();
  polls.set(opts.key, setInterval(() => void tick(), 2000));
}

export function stopWbBridgeProgressPoll(key: string): void {
  const timer = polls.get(key);
  if (timer) clearInterval(timer);
  polls.delete(key);
}

export function stopAllWbBridgeProgressPolls(): void {
  for (const key of [...polls.keys()]) {
    stopWbBridgeProgressPoll(key);
  }
}
