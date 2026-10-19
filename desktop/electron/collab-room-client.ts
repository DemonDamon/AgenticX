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

export type CollabProjectSummary = {
  id: string;
  name: string;
  instructions: string;
  main_room_id: string;
  member_count: number;
  created_at: string;
  updated_at: string;
};

export type CollabProjectCreateInput = {
  name: string;
  instructions?: string;
  settings?: { connectors: string[]; experts: string[]; skills: string[] };
  member_user_ids?: { user_id: string; display_name: string }[];
};

function readStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const items: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") continue;
    const text = item.trim();
    if (text) items.push(text);
  }
  return items;
}

function asProjectSummary(value: unknown): CollabProjectSummary | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const id = typeof row.id === "string" ? row.id.trim() : "";
  const name = typeof row.name === "string" ? row.name.trim() : "";
  if (!id || !name) return null;
  return {
    id,
    name,
    instructions: typeof row.instructions === "string" ? row.instructions : "",
    main_room_id: typeof row.main_room_id === "string" ? row.main_room_id : "",
    member_count: typeof row.member_count === "number" ? row.member_count : 0,
    created_at: typeof row.created_at === "string" ? row.created_at : "",
    updated_at: typeof row.updated_at === "string" ? row.updated_at : "",
  };
}

function readProjectSettings(
  value: unknown,
): CollabProjectCreateInput["settings"] | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  return {
    connectors: readStringList(record.connectors),
    experts: readStringList(record.experts),
    skills: readStringList(record.skills),
  };
}

function readProjectMembers(
  value: unknown,
): CollabProjectCreateInput["member_user_ids"] | undefined {
  if (!Array.isArray(value)) return undefined;
  const members: { user_id: string; display_name: string }[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const row = item as { user_id?: unknown; display_name?: unknown };
    const userId = typeof row.user_id === "string" ? row.user_id.trim() : "";
    const displayName = typeof row.display_name === "string" ? row.display_name.trim() : "";
    if (!userId || !displayName) continue;
    members.push({ user_id: userId, display_name: displayName });
  }
  return members;
}

export async function listProjects(
  deps: CollabRoomClientDeps,
): Promise<CollabRoomEnvelope<{ projects: CollabProjectSummary[] }>> {
  const result = await requestJson<{ projects?: unknown }>(deps, "/api/desktop/projects");
  if (!result.ok) return result;
  const projects = Array.isArray(result.data.projects)
    ? result.data.projects
        .map((item) => asProjectSummary(item))
        .filter((item): item is CollabProjectSummary => item !== null)
    : [];
  return { ok: true, data: { projects } };
}

export async function createProject(
  deps: CollabRoomClientDeps,
  input: CollabProjectCreateInput,
): Promise<CollabRoomEnvelope<{ project: CollabProjectSummary }>> {
  const settings = readProjectSettings(input.settings);
  const members = readProjectMembers(input.member_user_ids);
  const result = await requestJson<{ project?: unknown }>(deps, "/api/desktop/projects", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      name: input.name,
      ...(typeof input.instructions === "string" ? { instructions: input.instructions } : {}),
      ...(settings ? { settings } : {}),
      ...(members ? { member_user_ids: members } : {}),
    }),
  });
  if (!result.ok) return result;
  const project = asProjectSummary(result.data.project);
  if (!project) return { ok: false, error: UNAVAILABLE };
  return { ok: true, data: { project } };
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
