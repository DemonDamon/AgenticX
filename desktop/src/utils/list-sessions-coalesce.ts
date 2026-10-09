/**
 * Coalesce periodic full session-list polls across chat panes.
 *
 * Every open pane polls the full session list every ~2s just to read its own
 * execution_state. With dozens of panes the backend served 20+ full listings
 * per second and starved the event loop (SSE never closed). Share one result
 * (or one in-flight request) per avatar key for a short window.
 */

type ListSessionsFn = (avatarId?: string) => Promise<ListSessionsResult>;
export type ListSessionsResult = Awaited<ReturnType<Window["agenticxDesktop"]["listSessions"]>>;

const DEFAULT_MAX_AGE_MS = 1500;

type Entry = { at: number; promise: Promise<ListSessionsResult> };

export function createListSessionsCoalescer(
  fetcher: ListSessionsFn,
  now: () => number = () => Date.now(),
) {
  const entries = new Map<string, Entry>();
  return (avatarId?: string, maxAgeMs: number = DEFAULT_MAX_AGE_MS): Promise<ListSessionsResult> => {
    const key = avatarId ?? "";
    const hit = entries.get(key);
    if (hit && now() - hit.at < maxAgeMs) return hit.promise;
    const promise = fetcher(avatarId).catch((err) => {
      if (entries.get(key)?.promise === promise) entries.delete(key);
      throw err;
    });
    entries.set(key, { at: now(), promise });
    return promise;
  };
}

let shared: ReturnType<typeof createListSessionsCoalescer> | null = null;

/** Shared coalescer bound to window.agenticxDesktop.listSessions. */
export function listSessionsCoalesced(avatarId?: string): Promise<ListSessionsResult> {
  if (!shared) {
    shared = createListSessionsCoalescer((id) => window.agenticxDesktop.listSessions(id));
  }
  return shared(avatarId);
}
