import type { Message } from "../store";
import { mapLoadedSessionMessage, type LoadedSessionMessage } from "./session-message-map";

/** Initial paint: last user turn, capped — tool-heavy turns stay bounded. */
export const INITIAL_SESSION_TAIL_ROUNDS = 1;
export const INITIAL_SESSION_TAIL_LIMIT = 40;

export type SessionTailCacheEntry = {
  messages: Message[];
  startIndex: number;
  hasOlder: boolean;
};

const SESSION_TAIL_CACHE_MAX = 24;
const tailCache = new Map<string, SessionTailCacheEntry>();
const inflight = new Set<string>();
const inflightPromises = new Map<string, Promise<SessionTailCacheEntry | null>>();
const prefetchTimers = new Map<string, number>();

export function peekCachedSessionTail(sessionId: string): SessionTailCacheEntry | undefined {
  const sid = String(sessionId ?? "").trim();
  if (!sid) return undefined;
  return tailCache.get(sid);
}

export function getCachedSessionTail(sessionId: string): SessionTailCacheEntry | undefined {
  const sid = String(sessionId ?? "").trim();
  if (!sid) return undefined;
  const entry = tailCache.get(sid);
  if (!entry) return undefined;
  tailCache.delete(sid);
  tailCache.set(sid, entry);
  return entry;
}

export function cacheSessionTail(sessionId: string, entry: SessionTailCacheEntry): void {
  const sid = String(sessionId ?? "").trim();
  if (!sid) return;
  tailCache.delete(sid);
  tailCache.set(sid, entry);
  while (tailCache.size > SESSION_TAIL_CACHE_MAX) {
    const oldest = tailCache.keys().next().value;
    if (oldest === undefined) break;
    tailCache.delete(oldest);
  }
}

export async function fetchSessionTailPage(
  sessionId: string
): Promise<SessionTailCacheEntry | null> {
  const sid = String(sessionId ?? "").trim();
  if (!sid) return null;
  const page = await window.agenticxDesktop.loadSessionMessagesPage(sid, {
    tailRounds: INITIAL_SESSION_TAIL_ROUNDS,
    tailLimit: INITIAL_SESSION_TAIL_LIMIT,
  });
  if (!page.ok || !Array.isArray(page.messages)) return null;
  const messages = page.messages.map((item, index) =>
    mapLoadedSessionMessage(item as LoadedSessionMessage, sid, index)
  );
  return {
    messages,
    startIndex: page.start_index ?? 0,
    hasOlder: Boolean(page.has_older),
  };
}

async function prefetchSessionTailNow(sessionId: string): Promise<SessionTailCacheEntry | null> {
  const sid = String(sessionId ?? "").trim();
  if (!sid) return null;
  const cached = peekCachedSessionTail(sid);
  if (cached) return cached;
  if (inflight.has(sid)) {
    return inflightPromises.get(sid) ?? null;
  }
  inflight.add(sid);
  const promise = (async (): Promise<SessionTailCacheEntry | null> => {
    try {
      const entry = await fetchSessionTailPage(sid);
      if (entry) cacheSessionTail(sid, entry);
      return entry;
    } catch {
      return null;
    } finally {
      inflight.delete(sid);
      inflightPromises.delete(sid);
    }
  })();
  inflightPromises.set(sid, promise);
  return promise;
}

/**
 * Resolve tail messages for a session switch: cache hit, in-flight prefetch, or fetch.
 */
export async function resolveSessionTailForSwitch(
  sessionId: string
): Promise<SessionTailCacheEntry | null> {
  const sid = String(sessionId ?? "").trim();
  if (!sid) return null;
  const cached = peekCachedSessionTail(sid);
  if (cached) return cached;
  const pending = inflightPromises.get(sid);
  if (pending) return pending;
  return fetchSessionTailPage(sid);
}

/** Warm tail cache for visible history rows (debounced list refresh). */
export function prefetchSessionTailsBatch(sessionIds: string[], max = 8): void {
  const unique = [...new Set(sessionIds.map((id) => String(id ?? "").trim()).filter(Boolean))].slice(
    0,
    max
  );
  for (const sid of unique) {
    if (tailCache.has(sid) || inflight.has(sid)) continue;
    void prefetchSessionTailNow(sid);
  }
}

/** Debounced hover prefetch — warms tail cache before click. */
export function schedulePrefetchSessionTail(sessionId: string): void {
  const sid = String(sessionId ?? "").trim();
  if (!sid || tailCache.has(sid) || inflight.has(sid)) return;
  const prev = prefetchTimers.get(sid);
  if (prev !== undefined) window.clearTimeout(prev);
  prefetchTimers.set(
    sid,
    window.setTimeout(() => {
      prefetchTimers.delete(sid);
      void prefetchSessionTailNow(sid);
    }, 50)
  );
}

export function cancelPrefetchSessionTail(sessionId: string): void {
  const sid = String(sessionId ?? "").trim();
  const prev = prefetchTimers.get(sid);
  if (prev !== undefined) {
    window.clearTimeout(prev);
    prefetchTimers.delete(sid);
  }
}
