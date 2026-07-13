/**
 * Normalize chat message order for display / hydration.
 *
 * Persistence historically stamped user+assistant with the same (or inverted)
 * created_at within one send turn. Loading with ORDER BY created_at alone then
 * surfaces assistant above the user query.
 */
export function normalizeChatMessageOrder<
  T extends { id: string; role: string; created_at: string },
>(messages: T[]): T[] {
  const sorted = [...messages].sort((a, b) => {
    const ta = Date.parse(a.created_at);
    const tb = Date.parse(b.created_at);
    if (Number.isFinite(ta) && Number.isFinite(tb) && ta !== tb) return ta - tb;
    if (a.id < b.id) return -1;
    if (a.id > b.id) return 1;
    return 0;
  });

  for (let i = 0; i < sorted.length - 1; i += 1) {
    const current = sorted[i];
    const next = sorted[i + 1];
    if (!current || !next) continue;
    if (current.role !== "assistant" || next.role !== "user") continue;

    const ta = Date.parse(current.created_at);
    const tb = Date.parse(next.created_at);
    if (!Number.isFinite(ta) || !Number.isFinite(tb)) continue;

    // Same-turn inversion: assistant immediately before user with near-equal timestamps.
    const dt = tb - ta;
    if (dt >= 0 && dt <= 2000) {
      sorted[i] = next;
      sorted[i + 1] = current;
    }
  }

  return sorted;
}

/** User timestamp first; assistant strictly 1ms later so PG order stays stable. */
export function pairedMessageTimestamps(baseMs: number = Date.now()): {
  userCreatedAt: string;
  assistantCreatedAt: string;
} {
  return {
    userCreatedAt: new Date(baseMs).toISOString(),
    assistantCreatedAt: new Date(baseMs + 1).toISOString(),
  };
}
