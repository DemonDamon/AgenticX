/** Build read-only live-reattach SSE URL for a running session. */

export function reattachSessionStreamUrl(
  apiBase: string,
  sessionId: string,
  sinceSeq?: number,
): string {
  const base = apiBase.replace(/\/$/, "");
  const sid = encodeURIComponent(sessionId);
  const since = Number(sinceSeq ?? 0);
  if (Number.isFinite(since) && since > 0) {
    return `${base}/api/sessions/${sid}/stream?since=${Math.floor(since)}`;
  }
  return `${base}/api/sessions/${sid}/stream`;
}

/** Parse one SSE frame; returns event id (if any) and parsed JSON payload from data line. */
export function parseSseFrame(frame: string): { eventId: number | null; payload: unknown | null } {
  const lines = frame.split("\n");
  let eventId: number | null = null;
  let dataLine: string | undefined;
  for (const line of lines) {
    if (line.startsWith("id:")) {
      const raw = line.slice(3).trim();
      const n = Number(raw);
      eventId = Number.isFinite(n) ? Math.floor(n) : null;
    } else if (line.startsWith("data:")) {
      dataLine = line.slice(5).trim();
    }
  }
  if (!dataLine) return { eventId, payload: null };
  try {
    return { eventId, payload: JSON.parse(dataLine) as unknown };
  } catch {
    return { eventId, payload: null };
  }
}
