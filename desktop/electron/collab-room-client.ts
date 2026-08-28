export type CollabRoomClientDeps = {
  baseUrl: string;
  token: string;
  fetchImpl?: (input: string, init?: RequestInit) => Promise<Response>;
};

export type CollabRoomEnvelope<T> = { ok: true; data: T } | { ok: false; error: string };

export type CollabRoomSseEvent = { type: string; data: unknown };

export type CollabRoomStreamHandlers = {
  onEvent: (event: CollabRoomSseEvent) => void;
  onClosed: (reason: string) => void;
};

const LOGIN_EXPIRED = "企业登录已失效，请重新登录";
const REMOVED = "你已被移出该房间";
const NOT_FOUND = "房间不存在";
const UNAVAILABLE = "云房间服务暂时不可用";

export function normalizePortalBase(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return raw.trim().replace(/\/+$/, "");
}

export function mapCollabRoomHttpError(status: number): string {
  if (status === 401) return LOGIN_EXPIRED;
  if (status === 403) return REMOVED;
  if (status === 404) return NOT_FOUND;
  return UNAVAILABLE;
}

function requestFetch(deps: CollabRoomClientDeps) {
  return deps.fetchImpl ?? ((input: string, init?: RequestInit) => fetch(input, init));
}

async function requestJson<T>(
  deps: CollabRoomClientDeps,
  path: string,
  init: RequestInit = {},
): Promise<CollabRoomEnvelope<T>> {
  const base = normalizePortalBase(deps.baseUrl);
  if (!base) return { ok: false, error: UNAVAILABLE };
  try {
    const res = await requestFetch(deps)(`${base}${path}`, {
      ...init,
      headers: {
        authorization: `Bearer ${deps.token}`,
        accept: "application/json",
        ...(init.headers ?? {}),
      },
      signal: init.signal ?? AbortSignal.timeout(15_000),
    });
    if (!res.ok) return { ok: false, error: mapCollabRoomHttpError(res.status) };
    const json = (await res.json()) as { data?: T };
    if (!json || typeof json !== "object" || json.data === undefined) {
      return { ok: false, error: UNAVAILABLE };
    }
    return { ok: true, data: json.data };
  } catch {
    return { ok: false, error: UNAVAILABLE };
  }
}

export function listRooms(
  deps: CollabRoomClientDeps,
): Promise<CollabRoomEnvelope<{ rooms: unknown[] }>> {
  return requestJson(deps, "/api/desktop/rooms");
}

export function getRoom(
  deps: CollabRoomClientDeps,
  roomId: string,
): Promise<CollabRoomEnvelope<{ room: unknown; members: unknown[]; viewer_user_id?: string }>> {
  return requestJson(deps, `/api/desktop/rooms/${encodeURIComponent(roomId)}`);
}

export function listMessages(
  deps: CollabRoomClientDeps,
  roomId: string,
  opts: { afterSeq?: number; limit?: number } = {},
): Promise<CollabRoomEnvelope<{ messages: unknown[] }>> {
  const query = new URLSearchParams();
  if (typeof opts.afterSeq === "number") query.set("after_seq", String(opts.afterSeq));
  if (typeof opts.limit === "number") query.set("limit", String(opts.limit));
  const qs = query.toString();
  const suffix = qs ? `?${qs}` : "";
  return requestJson(deps, `/api/desktop/rooms/${encodeURIComponent(roomId)}/messages${suffix}`);
}

export function sendMessage(
  deps: CollabRoomClientDeps,
  roomId: string,
  content: string,
): Promise<CollabRoomEnvelope<{ message: unknown }>> {
  return requestJson(deps, `/api/desktop/rooms/${encodeURIComponent(roomId)}/messages`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ content }),
  });
}

export function parseSseChunk(buffer: string): { events: CollabRoomSseEvent[]; rest: string } {
  const normalized = buffer.replace(/\r\n/g, "\n");
  const events: CollabRoomSseEvent[] = [];
  let rest = normalized;
  while (true) {
    const sep = rest.indexOf("\n\n");
    if (sep < 0) break;
    const frame = rest.slice(0, sep);
    rest = rest.slice(sep + 2);
    if (!frame.trim()) continue;
    let type = "";
    const dataLines: string[] = [];
    for (const line of frame.split("\n")) {
      if (line.startsWith("event:")) type = line.slice(6).trim();
      else if (line.startsWith("data:")) dataLines.push(line.slice(5).trimStart());
    }
    if (!type) continue;
    const raw = dataLines.join("\n");
    let data: unknown = raw;
    try {
      data = JSON.parse(raw);
    } catch {
      /* keep raw string */
    }
    events.push({ type, data });
  }
  return { events, rest };
}

export async function streamRoomEvents(
  deps: CollabRoomClientDeps,
  roomId: string,
  handlers: CollabRoomStreamHandlers,
  signal: AbortSignal,
  afterSeq = 0,
): Promise<void> {
  const base = normalizePortalBase(deps.baseUrl);
  if (!base) {
    handlers.onClosed("error");
    return;
  }
  const url = `${base}/api/desktop/rooms/${encodeURIComponent(roomId)}/events?after_seq=${afterSeq}`;
  try {
    const res = await requestFetch(deps)(url, {
      headers: {
        authorization: `Bearer ${deps.token}`,
        accept: "text/event-stream",
      },
      signal,
    });
    if (!res.ok || !res.body) {
      handlers.onClosed(res.ok ? "end" : "error");
      return;
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    try {
      while (!signal.aborted) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parsed = parseSseChunk(buffer);
        buffer = parsed.rest;
        for (const event of parsed.events) handlers.onEvent(event);
      }
    } finally {
      try {
        await reader.cancel();
      } catch {
        /* ignore */
      }
    }
    handlers.onClosed(signal.aborted ? "aborted" : "end");
  } catch {
    handlers.onClosed(signal.aborted ? "aborted" : "error");
  }
}
